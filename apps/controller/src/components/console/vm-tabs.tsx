"use client";

import Image from "next/image";
import { useEffect, useMemo, useTransition } from "react";
import { Plus, Trash2, RotateCw, Loader2, AlertTriangle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VmConsole } from "@/components/console/vm-console";
import { useVms, createVm, deleteVm, resetVm } from "@/lib/useVms";
import { openOnboarding } from "@/lib/use-onboarding";
import type { Vm } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const ACTIVE_PARAM = "vm";

export function VmTabs() {
  const { vms, error, isLoading, mutate } = useVms();
  const [pending, startTransition] = useTransition();
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

  const onCreate = () => {
    startTransition(async () => {
      try {
        const vm = await createVm({}, mutate);
        setActive(vm.id);
      } catch (err) {
        console.error("[ui] createVm failed:", err);
      }
    });
  };

  const onDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteVm(id, { wipe: true }, mutate);
      } catch (err) {
        console.error("[ui] deleteVm failed:", err);
      }
    });
  };

  const onReset = (id: string) => {
    startTransition(async () => {
      try {
        const vm = await resetVm(id, { wipe: true }, mutate);
        setActive(vm.id);
      } catch (err) {
        console.error("[ui] resetVm failed:", err);
      }
    });
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
    return <EmptyState onCreate={onCreate} pending={pending} />;
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

        <div className="scroll-fade-x flex-1 overflow-x-auto">
          <TabsList variant="line" className="flex w-max items-center gap-3 pr-2">
            {vms.map((vm, idx) => (
              <div
                key={vm.id}
                className="group relative flex shrink-0 items-center"
                data-active={activeId === vm.id ? "true" : undefined}
              >
                <TabsTrigger
                  value={vm.id}
                  className="flex items-center gap-2 pr-1.5"
                >
                  {/* Editorial numeral. */}
                  <span className="font-mono text-[10px] tracking-[0.14em] text-ink-muted">
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
                  <span className="font-mono text-[12px] text-ink">
                    {vm.label || vm.name}
                  </span>
                </TabsTrigger>
                <VmTabActions
                  vm={vm}
                  onDelete={onDelete}
                  onReset={onReset}
                  pending={pending}
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
                disabled={pending}
                className="h-8 gap-1.5 text-[12px]"
              >
                <Plus className="size-3.5" />
                New VM
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Spin up a new container from the cursor-style-vm image
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

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
  pending,
}: {
  vm: Vm;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="-ml-1 flex items-center pr-1.5 opacity-0 transition group-hover:opacity-100 group-data-[active=true]:opacity-70 group-data-[active=true]:hover:opacity-100">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Reset VM"
            disabled={pending}
            onClick={() => {
              const ok = window.confirm(
                `Reset VM "${vm.label || vm.name}"?\n\nDestroys + recreates the container with a fresh /root volume. Use this to start over from the image baseline.`,
              );
              if (ok) onReset(vm.id);
            }}
            className="grid size-6 place-items-center rounded-[2px] text-ink-muted hover:text-ink"
          >
            <RotateCw className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Reset (wipe + recreate)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Delete VM"
            disabled={pending}
            onClick={() => {
              const ok = window.confirm(
                `Delete VM "${vm.label || vm.name}"?\n\nThis stops the container and removes its persistent /root volume. Anything installed (apps, profiles, downloads) is destroyed. Other VMs are unaffected.`,
              );
              if (ok) onDelete(vm.id);
            }}
            className="grid size-6 place-items-center rounded-[2px] text-ink-muted hover:text-vermilion"
          >
            <Trash2 className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Delete (wipes volume)</TooltipContent>
      </Tooltip>
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
