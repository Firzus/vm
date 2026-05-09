/**
 * Per-VM HTTP client. Every action goes through `/api/vm/{vmId}/...` so the
 * browser only ever hits the controller.
 *
 * Use `createVmClient(vmId)` to bind a client to one VM, or call the helpers
 * with a `vmId` argument when you don't have a stable instance.
 */

const BASE = "/api/vm";

async function request<T>(
  vmId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}/${encodeURIComponent(vmId)}/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export type Health = { status: string; display: string };
export type ScreenSize = { width: number; height: number };
export type ShellResult = {
  cmd: string;
  returncode: number;
  stdout: string;
  stderr: string;
};
export type LaunchResult = { ok: boolean; launched: string; log: string };

export interface VmClient {
  health: () => Promise<Health>;
  screenSize: () => Promise<ScreenSize>;
  shell: (cmd: string, timeout?: number) => Promise<ShellResult>;
  launch: (name: string) => Promise<LaunchResult>;
  /** URL to the screenshot endpoint (forced fresh via the timestamp). */
  screenshotUrl: () => string;
}

export function createVmClient(vmId: string): VmClient {
  return {
    health: () => request<Health>(vmId, "health"),
    screenSize: () => request<ScreenSize>(vmId, "screen_size"),
    shell: (cmd, timeout = 30) =>
      request<ShellResult>(vmId, "shell", {
        method: "POST",
        body: JSON.stringify({ cmd, timeout }),
      }),
    launch: (name) =>
      request<LaunchResult>(
        vmId,
        `launch?name=${encodeURIComponent(name)}`,
        { method: "POST" },
      ),
    screenshotUrl: () =>
      `${BASE}/${encodeURIComponent(vmId)}/screenshot?ts=${Date.now()}`,
  };
}
