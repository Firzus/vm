"use client";

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

  // Keep the URL in sync when the active id is auto-resolved (first VM).
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
    return <CenteredMessage tone="info" icon={<Loader2 className="size-4 animate-spin" />}>
      Loading VM list…
    </CenteredMessage>;
  }

  if (error) {
    return (
      <CenteredMessage tone="error" icon={<AlertTriangle className="size-4" />}>
        Failed to reach the controller API: {String(error.message ?? error)}
      </CenteredMessage>
    );
  }

  if (vms.length === 0) {
    return (
      <EmptyState onCreate={onCreate} pending={pending} />
    );
  }

  return (
    <Tabs
      value={activeId ?? undefined}
      onValueChange={setActive}
      className="h-full w-full"
    >
      <div className="flex items-center gap-2 border-b border-border bg-background/85 px-3 py-1.5">
        <TabsList variant="line" className="overflow-x-auto">
          {vms.map((vm) => (
            // We render the trigger and the per-VM actions side-by-side
            // inside a flex row instead of nesting buttons inside the trigger
            // — nested <button> elements aren't valid HTML and Radix's tab
            // pointer-down handler would swallow the inner click.
            <div
              key={vm.id}
              className="group relative flex items-center"
              data-active={activeId === vm.id ? "true" : undefined}
            >
              <TabsTrigger
                value={vm.id}
                className="flex items-center gap-2 pr-1.5 font-mono text-[12px]"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    vm.status === "running" && "bg-[var(--success)] shadow-[0_0_6px_var(--success)]",
                    vm.status === "starting" && "bg-[var(--warning)] shadow-[0_0_6px_var(--warning)]",
                    vm.status === "stopped" && "bg-muted-foreground",
                    vm.status === "error" && "bg-destructive",
                    (vm.status === "creating" || vm.status === "removing") &&
                      "bg-[var(--vercel-violet)] shadow-[0_0_6px_var(--vercel-violet)]",
                  )}
                />
                <span>{vm.label || vm.name}</span>
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
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCreate}
                disabled={pending}
                className="h-7 gap-1.5 text-[12px]"
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
          className="data-[state=inactive]:hidden h-[calc(100%-2.5rem)] m-0"
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
            className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
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
            className="grid size-5 place-items-center rounded text-muted-foreground hover:text-destructive"
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
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 bg-background spotlight">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative z-10 flex max-w-md flex-col items-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl bg-foreground/95 text-background">
          <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
            <path d="M12 2 L22 21 L2 21 Z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">No VM running</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Spin up a fresh container from the <code className="font-mono">cursor-style-vm</code> image
            to get an Ubuntu desktop with an automation API attached.
            You can run several VMs side by side, each in its own tab.
          </p>
        </div>
        <Button onClick={onCreate} disabled={pending} size="lg" className="gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create your first VM
        </Button>
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
        tone === "info" && "text-muted-foreground",
        tone === "error" && "text-destructive",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
