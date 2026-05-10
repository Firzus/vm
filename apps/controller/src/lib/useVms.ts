"use client";

/**
 * SWR-driven VM list, refreshed automatically when the controller's SSE
 * stream reports a Docker event. The Docker daemon stays the source of
 * truth — the SSE channel just tells us when to invalidate the cache.
 *
 * Implementation note: a single EventSource per browser tab is enough.
 * An earlier version of this file opened two — one inside
 * `useSWRSubscription` and a second inside a follow-up `useEffect` —
 * which kept long-lived /api/events HTTP connections alive until the
 * dev server's worker pool was exhausted.
 */
import useSWR, { type KeyedMutator } from "swr";
import { useEffect } from "react";
import type { CreateVmInput, Vm } from "./schemas";

const fetcher = async (url: string): Promise<{ vms: Vm[] }> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

export function useVms() {
  const { data, error, isLoading, mutate } = useSWR<{ vms: Vm[] }>(
    "/api/vms",
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false },
  );

  // Single SSE subscription that triggers an SWR revalidation on every
  // server-side Docker event. Closes on unmount, re-opens on remount.
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      es.addEventListener("vm", () => {
        mutate();
      });
    } catch {
      /* ignore — best-effort, the SWR cache will simply not auto-refresh */
    }
    return () => {
      es?.close();
    };
  }, [mutate]);

  return {
    vms: data?.vms ?? [],
    error,
    isLoading,
    mutate,
  } as const;
}

export async function createVm(
  input: CreateVmInput,
  mutate?: KeyedMutator<{ vms: Vm[] }>,
): Promise<Vm> {
  const res = await fetch("/api/vms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  const body = (await res.json()) as { vm: Vm };
  if (mutate) await mutate();
  return body.vm;
}

export async function deleteVm(
  id: string,
  opts: { wipe?: boolean } = {},
  mutate?: KeyedMutator<{ vms: Vm[] }>,
): Promise<void> {
  const url = `/api/vms/${encodeURIComponent(id)}${opts.wipe ? "?wipe=1" : ""}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  if (mutate) await mutate();
}

export async function restartVm(
  id: string,
  mutate?: KeyedMutator<{ vms: Vm[] }>,
): Promise<Vm> {
  const res = await fetch(`/api/vms/${encodeURIComponent(id)}/restart`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  const { vm } = (await res.json()) as { vm: Vm };
  if (mutate) await mutate();
  return vm;
}

export async function resetVm(
  id: string,
  opts: { wipe?: boolean } = {},
  mutate?: KeyedMutator<{ vms: Vm[] }>,
): Promise<Vm> {
  const url = `/api/vms/${encodeURIComponent(id)}/reset${opts.wipe ? "?wipe=1" : ""}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  const { vm } = (await res.json()) as { vm: Vm };
  if (mutate) await mutate();
  return vm;
}
