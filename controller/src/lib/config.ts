/**
 * Shared client-safe constants. Per-VM ports / hosts are NOT here anymore —
 * the client only ever talks to the controller (`/api/vm/{id}/...`), and the
 * controller knows where each VM lives.
 */

/** Default VNC password baked into every VM at create time. */
export const VM_VNC_PASSWORD = "agent";
