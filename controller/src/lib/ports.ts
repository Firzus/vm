/**
 * Loopback port allocator. Each VM reserves three ports — one per service
 * (automation API / noVNC / Chrome DevTools Protocol) — bound to 127.0.0.1
 * so they are never reachable off-host.
 *
 * The allocator is rehydrated at boot from already-running containers (via
 * `VmRegistry.bootstrap`).
 */
import { env } from "./env";

export type PortKind = "api" | "novnc" | "cdp";

export interface AllocatedPorts {
  api: number;
  novnc: number;
  cdp: number;
}

export class PortAllocator {
  private readonly used = {
    api: new Set<number>(),
    novnc: new Set<number>(),
    cdp: new Set<number>(),
  };

  private base(kind: PortKind): number {
    switch (kind) {
      case "api":
        return env.VM_PORT_API_BASE;
      case "novnc":
        return env.VM_PORT_NOVNC_BASE;
      case "cdp":
        return env.VM_PORT_CDP_BASE;
    }
  }

  /** Mark a port as taken (used at bootstrap when rehydrating). */
  reserve(kind: PortKind, port: number): void {
    this.used[kind].add(port);
  }

  /** Allocate the lowest free port within the pool for the given service. */
  allocate(kind: PortKind): number {
    const base = this.base(kind);
    for (let i = 0; i < env.VM_MAX_CONCURRENT; i += 1) {
      const port = base + i;
      if (!this.used[kind].has(port)) {
        this.used[kind].add(port);
        return port;
      }
    }
    throw new Error(
      `No free ${kind} port left (pool: ${base}-${base + env.VM_MAX_CONCURRENT - 1}). ` +
        "Increase VM_MAX_CONCURRENT or destroy idle VMs.",
    );
  }

  /** Allocate one port of each kind. */
  allocateTriple(): AllocatedPorts {
    // All-or-nothing semantics: rollback on failure to keep the pools sane.
    const api = this.allocate("api");
    let novnc: number | undefined;
    let cdp: number | undefined;
    try {
      novnc = this.allocate("novnc");
      cdp = this.allocate("cdp");
      return { api, novnc, cdp };
    } catch (err) {
      this.release({ api, novnc: novnc ?? -1, cdp: cdp ?? -1 });
      throw err;
    }
  }

  /** Free previously allocated ports. -1 ports are ignored (rollback safe). */
  release(ports: AllocatedPorts): void {
    if (ports.api > 0) this.used.api.delete(ports.api);
    if (ports.novnc > 0) this.used.novnc.delete(ports.novnc);
    if (ports.cdp > 0) this.used.cdp.delete(ports.cdp);
  }
}
