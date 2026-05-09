"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Check } from "lucide-react";
import type { StepProps } from "../onboarding";
import { Button } from "@/components/ui/button";
import { createVm, useVms } from "@/lib/useVms";

/**
 * Step 02 — first-VM creation. Real CTA that calls the controller API,
 * shows a serif "Spinning up…" while pending, and auto-advances once a
 * VM appears in the SWR cache.
 */
export function CreateVmStep({ goNext }: StepProps) {
  const { vms, mutate } = useVms();
  const [pending, setPending] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const advancedOnce = useRef(false);

  // Auto-advance the moment we see the freshly-created VM in the list.
  useEffect(() => {
    if (advancedOnce.current) return;
    if (createdId && vms.some((v) => v.id === createdId)) {
      advancedOnce.current = true;
      const id = window.setTimeout(() => goNext(), 900);
      return () => window.clearTimeout(id);
    }
  }, [vms, createdId, goNext]);

  const onCreate = async () => {
    setPending(true);
    setError(null);
    try {
      const vm = await createVm({}, mutate);
      setCreatedId(vm.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create VM");
      setPending(false);
    }
  };

  return (
    <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
      <figure className="paper-card relative aspect-[4/3] overflow-hidden md:order-1 md:aspect-auto md:h-full">
        <Image
          src="/onboarding/02-create.png"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
        <figcaption className="folio absolute bottom-3 left-3">
          Plate II · Genesis
        </figcaption>
      </figure>

      <div className="flex flex-col justify-center gap-6 md:order-2">
        <header className="space-y-2" data-reveal>
          <span className="folio">No. 02 — Create</span>
          <h2 className="serif-roman text-[clamp(28px,4.5vw,46px)] leading-[1.05] tracking-tight text-ink">
            <span className="serif">Press a button,</span>
            <br />
            receive a desktop.
          </h2>
        </header>

        <p
          className="max-w-xl text-[15px] leading-relaxed text-ink-muted md:text-[16px]"
          data-reveal
        >
          Each VM is a fresh Ubuntu container booted from the same image. The
          first run takes a moment while Docker pulls and warms up; after that
          new VMs appear in seconds.
        </p>

        <div
          className="paper-card-soft flex items-center gap-3 px-4 py-3"
          data-reveal
        >
          <span className="grid size-9 place-items-center bg-ink text-paper">
            {createdId ? (
              <Check className="size-4" />
            ) : pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
          </span>
          <div className="flex-1">
            <div className="serif text-[16px] text-ink">
              {createdId
                ? "Your VM is online."
                : pending
                  ? "Spinning up your first VM…"
                  : "Ready when you are."}
            </div>
            <div className="font-mono text-[11px] text-ink-muted">
              {createdId
                ? `id: ${createdId}`
                : "POST /api/vms — defaults: 2 GiB RAM · 2 vCPU"}
            </div>
          </div>
        </div>

        {error && (
          <p className="font-mono text-[12px] text-vermilion" data-reveal>
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1" data-reveal>
          <Button
            variant="primary"
            size="lg"
            onClick={onCreate}
            disabled={pending || !!createdId}
            className="gap-2"
          >
            {pending && !createdId ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {createdId ? "VM ready" : "Create my first VM"}
          </Button>
          <Button variant="link" size="lg" onClick={goNext} className="px-0">
            Skip — I already have one
          </Button>
        </div>
      </div>
    </div>
  );
}
