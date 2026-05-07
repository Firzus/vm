const BASE = "/api/vm";

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
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

export const vmClient = {
  health: () => request<Health>("health"),
  screenSize: () => request<ScreenSize>("screen_size"),
  shell: (cmd: string, timeout = 30) =>
    request<{
      cmd: string;
      returncode: number;
      stdout: string;
      stderr: string;
    }>("shell", {
      method: "POST",
      body: JSON.stringify({ cmd, timeout }),
    }),
  launch: (name: string) =>
    request<{ ok: boolean; launched: string; log: string }>(
      `launch?name=${encodeURIComponent(name)}`,
      { method: "POST" },
    ),
};
