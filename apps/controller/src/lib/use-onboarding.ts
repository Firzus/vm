"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "vm-console.onboarded.v1";
const EVENT = "vm-console:onboarding-open";
const STORAGE_EVENT = "vm-console:onboarding-storage";

/**
 * Tiny localStorage-backed onboarding state. Two pieces of state live here:
 *
 *   • `done` — has the user completed the onboarding at least once?
 *     Stored in localStorage as "true"/null.
 *   • `open` — is the modal currently visible? Pure in-memory state.
 *
 * The first-visit auto-open only fires when `done` is false on hydration.
 * The header's `?` button always opens regardless of `done`. Closing
 * without finishing (Esc) does NOT mark `done` so users can come back
 * later.
 *
 * Reading `done` and the "are we hydrated yet" flag both go through
 * useSyncExternalStore — that way no setState happens inside an effect,
 * which keeps the React 19 lint rule happy.
 */

function subscribeStorage(callback: () => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(STORAGE_EVENT, callback as EventListener);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(STORAGE_EVENT, callback as EventListener);
  };
}

function readDone(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

// "Hydrated" returns true on the client (post-mount) and false during SSR.
// Subscribe is a no-op because the value never changes after the first
// commit; React will re-run the snapshot on the client.
function subscribeNoop() {
  return () => {};
}
const getHydrated = () => true;
const getHydratedServer = () => false;

export function useOnboarding() {
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getHydrated,
    getHydratedServer,
  );
  const done = useSyncExternalStore(
    subscribeStorage,
    readDone,
    () => false,
  );

  const [open, setOpenState] = useState(false);

  // First-visit auto-open: schedule a one-shot setOpen 250ms after the
  // hydration flip, but only if the user hasn't already finished the
  // tour. The deferred open keeps focus management out of the initial
  // commit. setOpenState is invoked from a setTimeout — outside of the
  // effect's body — so it doesn't cascade.
  useEffect(() => {
    if (!hydrated || done) return;
    const id = window.setTimeout(() => setOpenState(true), 250);
    return () => window.clearTimeout(id);
  }, [hydrated, done]);

  // Window-event channel so any descendant can request the modal.
  useEffect(() => {
    const handler = () => setOpenState(true);
    window.addEventListener(EVENT, handler as EventListener);
    return () => window.removeEventListener(EVENT, handler as EventListener);
  }, []);

  const close = useCallback(() => {
    setOpenState(false);
  }, []);

  const complete = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
    } catch {
      /* ignore */
    }
    setOpenState(false);
  }, []);

  return {
    hydrated,
    open,
    done,
    setOpen: setOpenState,
    close,
    complete,
  } as const;
}

export function openOnboarding() {
  window.dispatchEvent(new CustomEvent(EVENT));
}
