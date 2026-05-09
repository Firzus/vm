"use client";

/**
 * SWR-driven VM list, refreshed automatically when the controller's SSE
 * stream reports a Docker event. The Docker daemon stays the source of
 * truth — the SSE channel just tells us when to invalidate the cache.
 */
import useSWR, { type KeyedMutator } from "swr";
import useSWRSubscription from "swr/subscription";
import { useEffect } from "react";
import type { CreateVmInput, Vm, VmEvent } from "./schemas";

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

  // Subscribe to the SSE stream and invalidate on every event.
  useSWRSubscription("/api/events", (key, { next }) => {
    const es = new EventSource(key);
    es.addEventListener("vm", (evt) => {
      try {
        const parsed = JSON.parse((evt as MessageEvent).data) as VmEvent;
        next(null, parsed);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("error", () => {
      next(new Error("event_stream_error"));
    });
    return () => es.close();
  });

  // The subscription's `data` is unused — we only care about the side
  // effect of mutating SWR's cache. We do that here so every event fires
  // a single revalidation regardless of how many components subscribe.
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      es.addEventListener("vm", () => {
        mutate();
      });
    } catch {
      /* ignore */
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
