/**
 * Zod schemas shared between server (route handlers, MCP-facing controller
 * endpoints) and client (SWR fetchers, optimistic updates).
 *
 * Source of truth for HTTP boundaries. Keep this file dependency-light so it
 * can be imported from both server and client bundles.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Environment validated once at server boot. Throws on invalid values. */
export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  /** Tag of the Docker image used for every VM. */
  VM_IMAGE: z.string().default("cursor-style-vm:latest"),
  /** Repo root used as build context when the image is missing. */
  VM_REPO_DIR: z.string().optional(),
  /** Memory cap per VM in MB. */
  VM_MEMORY_MB: z.coerce.number().int().positive().max(65536).default(2048),
  /** vCPU count per VM (fractional values allowed via NanoCpus). */
  VM_CPUS: z.coerce.number().positive().max(16).default(2),
  /** Shared memory size for /dev/shm (Chrome benefits from this). */
  VM_SHM_MB: z.coerce.number().int().positive().max(65536).default(2048),
  /** Default screen geometry baked into Xvfb at create time. */
  VM_SCREEN_WIDTH: z.coerce.number().int().positive().default(1920),
  VM_SCREEN_HEIGHT: z.coerce.number().int().positive().default(1080),
  /** VNC password baked into the container at create time. */
  VM_VNC_PASSWORD: z.string().min(1).default("agent"),
  /** Loopback port pools. The controller never binds on 0.0.0.0. */
  VM_PORT_API_BASE: z.coerce.number().int().min(1024).max(65000).default(18000),
  VM_PORT_NOVNC_BASE: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65000)
    .default(16080),
  VM_PORT_CDP_BASE: z.coerce.number().int().min(1024).max(65000).default(19222),
  /** Hard cap on concurrent VMs (also bounds the port pools). */
  VM_MAX_CONCURRENT: z.coerce.number().int().positive().max(64).default(8),
});

export type Env = z.infer<typeof EnvSchema>;

// ---------------------------------------------------------------------------
// VM resources
// ---------------------------------------------------------------------------

export const VmStatusSchema = z.enum([
  "creating",
  "starting",
  "running",
  "stopped",
  "error",
  "removing",
]);
export type VmStatus = z.infer<typeof VmStatusSchema>;

export const VmPortsSchema = z.object({
  api: z.number().int().positive(),
  novnc: z.number().int().positive(),
  cdp: z.number().int().positive(),
});
export type VmPorts = z.infer<typeof VmPortsSchema>;

export const VmSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  containerId: z.string().min(1),
  status: VmStatusSchema,
  createdAt: z.string().datetime(),
  ports: VmPortsSchema,
  /** Optional human-readable label entered by the user. */
  label: z.string().optional(),
  /** Last error message when status === "error". */
  error: z.string().optional(),
});
export type Vm = z.infer<typeof VmSchema>;

// ---------------------------------------------------------------------------
// API inputs
// ---------------------------------------------------------------------------

const idChars = /^[a-z0-9-]+$/i;

export const CreateVmInput = z.object({
  /** Optional label shown in the UI tabs. Auto-generated if omitted. */
  label: z.string().min(1).max(64).optional(),
  /** Override default memory for this VM in MB. */
  memoryMb: z.coerce.number().int().positive().max(65536).optional(),
  /** Override default CPU count. */
  cpus: z.coerce.number().positive().max(16).optional(),
});
export type CreateVmInput = z.infer<typeof CreateVmInput>;

export const VmIdParam = z.string().regex(idChars, "invalid vm id");

export const DeleteVmQuery = z.object({
  /** When true, also remove the per-VM /root volume. */
  wipe: z
    .union([z.boolean(), z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .transform((v) => v === true || v === "1" || v === "true")
    .default(false),
});

export const ResetVmQuery = DeleteVmQuery;

// ---------------------------------------------------------------------------
// Events (SSE stream from /api/events)
// ---------------------------------------------------------------------------

export const VmEventKindSchema = z.enum([
  "registered",
  "starting",
  "started",
  "stopping",
  "stopped",
  "died",
  "destroyed",
  "error",
]);
export type VmEventKind = z.infer<typeof VmEventKindSchema>;

export const VmEventSchema = z.object({
  vmId: z.string().min(1),
  kind: VmEventKindSchema,
  at: z.string().datetime(),
  message: z.string().optional(),
});
export type VmEvent = z.infer<typeof VmEventSchema>;
