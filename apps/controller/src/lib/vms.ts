/**
 * VM lifecycle: create / list / delete / restart / reset, plus a small
 * in-memory registry rehydrated from running containers (label-filtered).
 *
 * Each VM is a separate Docker container instantiated from the shared
 * `cursor-style-vm:latest` image, with its own loopback-bound ports and its
 * own /root volume. The Docker daemon is the source of truth: this module
 * never persists state to disk.
 *
 * SERVER ONLY.
 */
import { randomBytes } from "node:crypto";
import type Dockerode from "dockerode";
import { env } from "./env";
import { getDocker } from "./docker";
import { ensureVmImage } from "./image";
import { PortAllocator } from "./ports";
import { CreateVmInput, type Vm, type VmStatus } from "./schemas";

const LABEL_ROLE = "cursor-vm.role";
const LABEL_ROLE_VALUE = "vm";
const LABEL_ID = "cursor-vm.id";
const LABEL_LABEL = "cursor-vm.label";
const LABEL_CREATED = "cursor-vm.createdAt";

function newId(): string {
  // 6 bytes → 12 hex chars: short enough to be readable in URLs, long
  // enough to make collisions astronomically unlikely.
  return randomBytes(6).toString("hex");
}

function statusFromInspect(state: Dockerode.ContainerInspectInfo["State"]): VmStatus {
  if (state.Running) return "running";
  if (state.Restarting) return "starting";
  if (state.Status === "created") return "creating";
  if (state.ExitCode && state.ExitCode !== 0) return "error";
  return "stopped";
}

// Placeholder for future per-VM metadata we don't want to round-trip publicly
// (resource caps, custom env, etc.). Keep as a type alias rather than an
// empty interface to satisfy `@typescript-eslint/no-empty-object-type`.
type VmInternal = Vm;

class VmRegistry {
  private readonly vms = new Map<string, VmInternal>();
  private readonly ports = new PortAllocator();
  private bootstrapped = false;

  /**
   * Rehydrate from the Docker daemon. Safe to call multiple times — only the
   * first invocation does work.
   */
  async bootstrap(): Promise<void> {
    if (this.bootstrapped) return;
    const containers = await getDocker().listContainers({
      all: true,
      filters: { label: [`${LABEL_ROLE}=${LABEL_ROLE_VALUE}`] },
    });

    for (const c of containers) {
      const id = c.Labels?.[LABEL_ID];
      if (!id) continue;
      const name = (c.Names?.[0] ?? `/vm-${id}`).replace(/^\//, "");
      const ports = portsFromContainerSummary(c);
      if (!ports) continue;
      this.ports.reserve("api", ports.api);
      this.ports.reserve("novnc", ports.novnc);
      this.ports.reserve("cdp", ports.cdp);
      this.vms.set(id, {
        id,
        name,
        containerId: c.Id,
        status: statusFromState(c.State),
        createdAt:
          c.Labels?.[LABEL_CREATED] ?? new Date(c.Created * 1000).toISOString(),
        ports,
        label: c.Labels?.[LABEL_LABEL] || undefined,
      });
    }
    this.bootstrapped = true;
  }

  list(): Vm[] {
    return [...this.vms.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  get(id: string): Vm | null {
    return this.vms.get(id) ?? null;
  }

  /** Allocate ports + create + start a fresh container. */
  async create(input: CreateVmInput): Promise<Vm> {
    await this.bootstrap();
    if (this.vms.size >= env.VM_MAX_CONCURRENT) {
      throw new Error(
        `Concurrent VM limit reached (${env.VM_MAX_CONCURRENT}). ` +
          "Delete a VM before creating another.",
      );
    }
    await ensureVmImage();

    const id = newId();
    const name = `vm-${id}`;
    const allocated = this.ports.allocateTriple();
    const memoryMb = input.memoryMb ?? env.VM_MEMORY_MB;
    const cpus = input.cpus ?? env.VM_CPUS;
    const createdAt = new Date().toISOString();

    let containerId = "";
    try {
      const container = await getDocker().createContainer({
        Image: env.VM_IMAGE,
        name,
        Hostname: name,
        Labels: {
          [LABEL_ROLE]: LABEL_ROLE_VALUE,
          [LABEL_ID]: id,
          [LABEL_LABEL]: input.label ?? "",
          [LABEL_CREATED]: createdAt,
        },
        Env: [
          `SCREEN_WIDTH=${env.VM_SCREEN_WIDTH}`,
          `SCREEN_HEIGHT=${env.VM_SCREEN_HEIGHT}`,
          `SCREEN_DEPTH=24`,
          `VNC_PASSWORD=${env.VM_VNC_PASSWORD}`,
        ],
        ExposedPorts: {
          "8000/tcp": {},
          "6080/tcp": {},
          "9222/tcp": {},
        },
        HostConfig: {
          Binds: [`${volumeName(id)}:/root`],
          PortBindings: {
            "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: String(allocated.api) }],
            "6080/tcp": [
              { HostIp: "127.0.0.1", HostPort: String(allocated.novnc) },
            ],
            "9222/tcp": [{ HostIp: "127.0.0.1", HostPort: String(allocated.cdp) }],
          },
          Memory: memoryMb * 1024 * 1024,
          NanoCpus: Math.round(cpus * 1e9),
          ShmSize: env.VM_SHM_MB * 1024 * 1024,
          RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
        },
      });
      containerId = container.id;
      await container.start();
    } catch (err) {
      // Roll back ports + best-effort container cleanup.
      this.ports.release(allocated);
      if (containerId) {
        await getDocker()
          .getContainer(containerId)
          .remove({ force: true })
          .catch(() => undefined);
      }
      throw err;
    }

    const vm: VmInternal = {
      id,
      name,
      containerId,
      status: "starting",
      createdAt,
      ports: allocated,
      label: input.label,
    };
    this.vms.set(id, vm);
    // Mark running once Docker has actually started the container; we don't
    // wait for the in-VM API to come up here — the SSE stream will surface
    // "started" once Docker emits the event.
    return vm;
  }

  /** Stop + remove a container. Optionally wipes the per-VM volume. */
  async delete(id: string, opts: { wipe?: boolean } = {}): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) throw new Error(`unknown vm: ${id}`);
    vm.status = "removing";

    const c = getDocker().getContainer(vm.containerId);
    await c.stop({ t: 5 }).catch(() => undefined);
    await c.remove({ force: true, v: false }).catch(() => undefined);

    if (opts.wipe) {
      await getDocker()
        .getVolume(volumeName(id))
        .remove()
        .catch((err) => {
          // Volume might already have been auto-removed; log non-fatal.
          if (err && typeof err === "object" && "statusCode" in err && err.statusCode !== 404) {
            console.warn(`[vms] failed to remove volume for ${id}:`, err);
          }
        });
    }

    this.ports.release(vm.ports);
    this.vms.delete(id);
  }

  async restart(id: string): Promise<Vm> {
    const vm = this.vms.get(id);
    if (!vm) throw new Error(`unknown vm: ${id}`);
    await getDocker().getContainer(vm.containerId).restart({ t: 5 });
    vm.status = "starting";
    return vm;
  }

  /**
   * Hard reset: destroy the container (and optionally the volume) and create
   * a fresh one. Returns the new VM with the same id when possible.
   */
  async reset(id: string, opts: { wipe?: boolean } = {}): Promise<Vm> {
    const old = this.vms.get(id);
    if (!old) throw new Error(`unknown vm: ${id}`);
    const label = old.label;
    await this.delete(id, opts);
    return this.create({ label });
  }

  /** Refresh status from Docker (used by /api/vms when needed). */
  async refresh(): Promise<void> {
    for (const vm of this.vms.values()) {
      try {
        const info = await getDocker().getContainer(vm.containerId).inspect();
        vm.status = statusFromInspect(info.State);
      } catch {
        vm.status = "error";
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  // Survive Next.js hot reloads in dev so we don't lose track of containers.
  var __cursorVmRegistry: VmRegistry | undefined;
}

export function getRegistry(): VmRegistry {
  if (!globalThis.__cursorVmRegistry) {
    globalThis.__cursorVmRegistry = new VmRegistry();
  }
  return globalThis.__cursorVmRegistry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function volumeName(id: string): string {
  return `cursor-vm-home-${id}`;
}

function statusFromState(state: string): VmStatus {
  switch (state) {
    case "running":
      return "running";
    case "created":
      return "creating";
    case "restarting":
      return "starting";
    case "removing":
      return "removing";
    case "exited":
    case "dead":
      return "stopped";
    default:
      return "error";
  }
}

interface ContainerSummaryWithPorts {
  Ports?: Array<{ PrivatePort?: number; PublicPort?: number; Type?: string }>;
}

function portsFromContainerSummary(
  c: ContainerSummaryWithPorts,
): { api: number; novnc: number; cdp: number } | null {
  const get = (priv: number) =>
    c.Ports?.find((p) => p.PrivatePort === priv && p.Type === "tcp")?.PublicPort;
  const api = get(8000);
  const novnc = get(6080);
  const cdp = get(9222);
  if (!api || !novnc || !cdp) return null;
  return { api, novnc, cdp };
}
