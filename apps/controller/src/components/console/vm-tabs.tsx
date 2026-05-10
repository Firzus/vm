"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2, RotateCw, Loader2, AlertTriangle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { VmConsole } from "@/components/console/vm-console";
import { useVms, createVm, deleteVm, resetVm } from "@/lib/useVms";
import { openOnboarding } from "@/lib/use-onboarding";
import type { Vm } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const ACTIVE_PARAM = "vm";

type PendingAction = "deleting" | "resetting";

export function VmTabs() {
  const { vms, error, isLoading, mutate } = useVms();
  const [creating, startCreateTransition] = useTransition();
  // Per-VM in-flight action. Tracked here (rather than in <VmTabActions>) so
  // the parent can drive the optimistic SWR update + rollback on delete and
  // surface a single inline error notice scoped to the failing VM.
  const [pendingActions, setPendingActions] = useState<
    Record<string, PendingAction | undefined>
  >({});
  const [actionError, setActionError] = useState<
    { id: string; message: string } | null
  >(null);
  const router = useRouter();
  const search = useSearchParams();

  const requestedId = search.get(ACTIVE_PARAM);
  const activeId = useMemo(() => {
    if (requestedId && vms.some((v) => v.id === requestedId)) return requestedId;
    return vms[0]?.id ?? null;
  }, [vms, requestedId]);

  useEffect(() => {
    if (activeId && requestedId !== activeId) {
      const next = new URLSearchParams(search.toString());
      next.set(ACTIVE_PARAM, activeId);
      router.replace(`/?${next.toString()}`, { scroll: false });
    }
  }, [activeId, requestedId, router, search]);

  const setActive = (id: string) => {
    const next = new URLSearchParams(search.toString());
    next.set(ACTIVE_PARAM, id);
    router.replace(`/?${next.toString()}`, { scroll: false });
  };

  const setPending = (id: string, action: PendingAction | undefined) => {
    setPendingActions((prev) => {
      if (action === undefined) {
        if (prev[id] === undefined) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === action) return prev;
      return { ...prev, [id]: action };
    });
  };

  // Auto-dismiss the inline error after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!actionError) return;
    const id = window.setTimeout(() => setActionError(null), 5000);
    return () => window.clearTimeout(id);
  }, [actionError]);

  const onCreate = () => {
    startCreateTransition(async () => {
      try {
        const vm = await createVm({}, mutate);
        setActive(vm.id);
      } catch (err) {
        console.error("[ui] createVm failed:", err);
        setActionError({
          id: "__create__",
          message: err instanceof Error ? err.message : "Failed to create VM",
        });
      }
    });
  };

  const onDelete = async (id: string) => {
    setPending(id, "deleting");
    setActionError((prev) => (prev?.id === id ? null : prev));
    // Optimistically drop the VM from the SWR cache so the tab transitions
    // out immediately. We still revalidate after the request settles so the
    // SSE Docker event can't leave the cache out of sync.
    try {
      await mutate(
        async () => {
          await deleteVm(id, { wipe: true });
          return undefined;
        },
        {
          optimisticData: (current) =>
            current
              ? { vms: current.vms.filter((v) => v.id !== id) }
              : { vms: [] },
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      );
    } catch (err) {
      console.error("[ui] deleteVm failed:", err);
      setActionError({
        id,
        message: err instanceof Error ? err.message : "Failed to delete VM",
      });
    } finally {
      setPending(id, undefined);
    }
  };

  const onReset = async (id: string) => {
    setPending(id, "resetting");
    setActionError((prev) => (prev?.id === id ? null : prev));
    try {
      const vm = await resetVm(id, { wipe: true }, mutate);
      setActive(vm.id);
    } catch (err) {
      console.error("[ui] resetVm failed:", err);
      setActionError({
        id,
        message: err instanceof Error ? err.message : "Failed to reset VM",
      });
    } finally {
      setPending(id, undefined);
    }
  };

  if (isLoading && vms.length === 0) {
    return (
      <CenteredMessage tone="info" icon={<Loader2 className="size-4 animate-spin" />}>
        Loading VM list…
      </CenteredMessage>
    );
  }

  if (error) {
    return (
      <CenteredMessage tone="error" icon={<AlertTriangle className="size-4" />}>
        Failed to reach the controller API: {String(error.message ?? error)}
      </CenteredMessage>
    );
  }

  if (vms.length === 0) {
    return <EmptyState onCreate={onCreate} pending={creating} />;
  }

  return (
    <Tabs
      value={activeId ?? undefined}
      onValueChange={setActive}
      className="h-full w-full"
    >
      <div className="flex items-center gap-2 border-b border-rule bg-paper/85 px-3 py-2 backdrop-blur-md md:px-4">
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted md:inline">
          Sessions
        </span>
        <span aria-hidden className="hidden h-3 w-px bg-rule md:inline-block" />

        {/*
          Horizontal-only scroll. CSS forces overflow-y:auto when overflow-x is
          auto, which would let the strip scroll vertically — and the active
          TabsTrigger underline (an absolute ::after at -bottom-[7px]) is just
          enough overflow to trigger it. We pin overflow-y to hidden, then
          reserve room for the underline with pb-2 and cancel the extra height
          with -mb-2 so the surrounding header layout is unchanged.
        */}
        <div className="scroll-fade-x -mb-2 flex-1 overflow-x-auto overflow-y-hidden pb-2">
          <TabsList variant="line" className="flex w-max items-center gap-3 pr-2">
            {vms.map((vm, idx) => (
              <div
                key={vm.id}
                className="group relative flex shrink-0 items-center rounded-[2px] data-[active=true]:bg-paper-2"
                data-active={activeId === vm.id ? "true" : undefined}
              >
                <TabsTrigger
                  value={vm.id}
                  className="group/trigger flex items-center gap-2 rounded-[2px] pl-1.5 pr-1.5"
                >
                  {/* Editorial numeral — vermilion when active. */}
                  <span className="font-mono text-[10px] tracking-[0.14em] text-ink-muted transition-colors group-data-[state=active]/trigger:text-vermilion">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      vm.status === "running" && "bg-vermilion",
                      vm.status === "starting" && "bg-vermilion/70",
                      vm.status === "stopped" && "bg-rule-strong",
                      vm.status === "error" && "bg-vermilion",
                      (vm.status === "creating" || vm.status === "removing") &&
                        "bg-ink-muted",
                    )}
                  />
                  <span className="font-mono text-[12px] text-ink-muted transition-colors group-hover/trigger:text-ink group-data-[state=active]/trigger:font-semibold group-data-[state=active]/trigger:text-ink">
                    {vm.label || vm.name}
                  </span>
                </TabsTrigger>
                <VmTabActions
                  vm={vm}
                  onDelete={onDelete}
                  onReset={onReset}
                  pendingAction={pendingActions[vm.id]}
                />
              </div>
            ))}
          </TabsList>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCreate}
                disabled={creating}
                className="h-8 gap-1.5 text-[12px]"
              >
                {creating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                New VM
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Spin up a new container from the cursor-style-vm image
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {actionError && (
        <div className="border-b border-vermilion/30 bg-vermilion/5 px-4 py-1.5">
          <div className="flex items-center gap-2 font-mono text-[11px] text-vermilion">
            <AlertTriangle className="size-3" />
            <span className="truncate">{actionError.message}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="ml-auto rounded-[2px] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-vermilion/80 transition hover:text-vermilion"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {vms.map((vm) => (
        <TabsContent
          key={vm.id}
          value={vm.id}
          className="data-[state=inactive]:hidden h-[calc(100%-2.75rem)] m-0"
          forceMount
        >
          <VmConsole vm={vm} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function VmTabActions({
  vm,
  onDelete,
  onReset,
  pendingAction,
}: {
  vm: Vm;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
  pendingAction: PendingAction | undefined;
}) {
  const isDeleting = pendingAction === "deleting";
  const isResetting = pendingAction === "resetting";
  // Any in-flight destructive action on this tab disables both buttons so the
  // user can't queue a Reset while a Delete is finishing (or vice versa).
  const busy = isDeleting || isResetting;

  return (
    <div
      // While an action is in-flight, force the actions visible — the spinner
      // shouldn't disappear just because the cursor leaves the tab.
      data-busy={busy ? "true" : undefined}
      className="-ml-1 flex items-center pr-1.5 opacity-0 transition group-hover:opacity-100 group-data-[active=true]:opacity-70 group-data-[active=true]:hover:opacity-100 data-[busy=true]:opacity-100"
    >
      <AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                aria-label={isResetting ? "Resetting VM…" : "Reset VM"}
                aria-busy={isResetting || undefined}
                disabled={busy}
                className="grid size-6 place-items-center rounded-[2px] text-ink-muted hover:text-ink disabled:cursor-default disabled:opacity-70 disabled:hover:text-ink-muted"
              >
                {isResetting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RotateCw className="size-3" />
                )}
              </button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isResetting ? "Resetting…" : "Reset (wipe + recreate)"}
          </TooltipContent>
        </Tooltip>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset VM &ldquo;{vm.label || vm.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Destroys + recreates the container with a fresh /root volume. Use
              this to start over from the image baseline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onReset(vm.id)}
            >
              Reset VM
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                aria-label={isDeleting ? "Deleting VM…" : "Delete VM"}
                aria-busy={isDeleting || undefined}
                disabled={busy}
                className={cn(
                  "grid size-6 place-items-center rounded-[2px] text-ink-muted hover:text-vermilion disabled:cursor-default disabled:hover:text-ink-muted",
                  isDeleting && "text-vermilion disabled:text-vermilion",
                  busy && !isDeleting && "disabled:opacity-70",
                )}
              >
                {isDeleting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
              </button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isDeleting ? "Deleting…" : "Delete (wipes volume)"}
          </TooltipContent>
        </Tooltip>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete VM &ldquo;{vm.label || vm.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This stops the container and removes its persistent /root volume.
              Anything installed (apps, profiles, downloads) is destroyed. Other
              VMs are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onDelete(vm.id)}
            >
              Delete VM
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  pending,
}: {
  onCreate: () => void;
  pending: boolean;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-transparent">
      <div className="relative z-10 grid w-full max-w-6xl grid-cols-1 gap-8 px-6 py-10 md:grid-cols-[1.05fr_1fr] md:gap-12 md:px-10 lg:gap-16">
        {/* Editorial cover — folio + numeral + serif title. */}
        <div className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="folio">VM Console · Vol. I · Issue 01</span>
            <span className="folio">Empty session</span>
          </div>

          <div className="my-8">
            <span
              aria-hidden
              className="numeral-display block text-[clamp(120px,22vw,260px)]"
            >
              No.
              <span className="text-vermilion">01</span>
            </span>
          </div>

          <div className="space-y-5">
            <h1 className="serif-roman text-[clamp(28px,4vw,44px)] leading-[1.05] tracking-tight text-ink">
              <span className="serif">A clean</span> Ubuntu desktop,
              <br className="hidden sm:block" />
              quietly waiting in the wings.
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-ink-muted">
              Spin up a fresh container from the{" "}
              <span className="mono text-ink">cursor-style-vm</span> image to
              get a fully isolated XFCE desktop with an automation API attached.
              Many can run side by side, each in its own tab.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                onClick={onCreate}
                disabled={pending}
                size="lg"
                variant="primary"
                className="gap-2"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Create your first VM
              </Button>
              <Button
                variant="link"
                size="lg"
                className="px-0"
                onClick={() => openOnboarding()}
              >
                Read the editorial tour
              </Button>
            </div>
          </div>
        </div>

        {/* Editorial hero artwork. */}
        <div className="relative hidden md:block">
          <div className="absolute inset-y-0 -left-6 w-px bg-rule" aria-hidden />
          <div className="paper-card relative aspect-[14/9] w-full overflow-hidden">
            <Image
              src="/empty-state-hero.png"
              alt=""
              fill
              priority
              sizes="(max-width: 768px) 100vw, 600px"
              className="object-cover"
            />
            <div className="folio absolute bottom-3 left-3">Plate I</div>
          </div>
          <p className="mt-3 max-w-sm text-[12px] leading-relaxed text-ink-muted">
            <span className="serif">A triangle waits to be inhabited.</span>{" "}
            Each VM is a fresh sheet of paper — drive it from your browser, or
            from any agent that speaks HTTP.
          </p>
        </div>
      </div>
    </div>
  );
}

function CenteredMessage({
  tone,
  icon,
  children,
}: {
  tone: "info" | "error";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center gap-2 px-6 text-center text-[13px]",
        tone === "info" && "text-ink-muted",
        tone === "error" && "text-vermilion",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
