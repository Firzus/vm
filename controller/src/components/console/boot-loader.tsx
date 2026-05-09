"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "tunnel", label: "Establishing tunnel", target: "ws://localhost:6080" },
  { id: "rfb", label: "Negotiating RFB protocol", target: "003.008" },
  { id: "auth", label: "Authenticating", target: "ok" },
  { id: "fb", label: "Requesting framebuffer", target: "1920×1080" },
  { id: "input", label: "Handing over input", target: "ok" },
];

type Props = {
  active: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  className?: string;
};

export function BootLoader({
  active,
  errorMessage,
  onRetry,
  className,
}: Props) {
  const [done, setDone] = useState<number>(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    setDone(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setDone(i);
      if (i >= STEPS.length) clearInterval(id);
    }, 220);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div
      ref={root}
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-500",
        active ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      <div className="absolute inset-0 bg-background/85 backdrop-blur-md" />

      <div
        className="relative w-[min(440px,90%)] overflow-hidden rounded-xl border border-border bg-card/90 p-6 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] border-shimmer"
        data-active="true"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-md bg-foreground/95 text-background">
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
              <path d="M12 2 L22 21 L2 21 Z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-semibold tracking-tight">
              Connecting to VM
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              ws://localhost:6080/websockify
            </div>
          </div>
        </div>

        <ul className="space-y-1.5">
          {STEPS.map((s, i) => {
            const state =
              i < done ? "done" : i === done ? "active" : "pending";
            return (
              <li
                key={s.id}
                className="flex items-center gap-2.5 font-mono text-[12px]"
              >
                <StepDot state={state} />
                <span
                  className={cn(
                    state === "done" && "text-foreground/90",
                    state === "active" && "text-foreground",
                    state === "pending" && "text-muted-foreground/70",
                  )}
                >
                  {s.label}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {state === "done" ? s.target : state === "active" ? "…" : ""}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="relative mt-5 h-[2px] overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-200 ease-out"
            style={{
              width: `${(done / STEPS.length) * 100}%`,
              background:
                "linear-gradient(90deg, var(--vercel-violet), var(--vercel-blue))",
              boxShadow: "0 0 12px var(--vercel-violet)",
            }}
          />
          <div className="shimmer-line absolute inset-0 opacity-60" />
        </div>

        {errorMessage && (
          <div className="mt-5 flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide">
                Connection failed
              </div>
              <div className="mt-0.5 font-mono text-foreground/85">
                {errorMessage}
              </div>
              {onRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRetry}
                  className="mt-3 h-7 gap-1.5 border-destructive/40 px-2 text-[11px] text-destructive hover:bg-destructive/15 hover:text-destructive"
                >
                  <RotateCw className="size-3" />
                  Retry connection
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDot({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done")
    return (
      <span
        aria-hidden
        className="grid size-3.5 place-items-center rounded-full"
        style={{ background: "color-mix(in oklab, var(--success) 22%, transparent)" }}
      >
        <svg
          viewBox="0 0 12 12"
          className="size-2"
          fill="none"
          stroke="var(--success)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2.5,6.5 5,9 9.5,3.5" />
        </svg>
      </span>
    );
  if (state === "active")
    return (
      <span className="relative inline-flex size-3.5 items-center justify-center">
        <span className="absolute size-2 rounded-full bg-[var(--vercel-violet)] shadow-[0_0_8px_var(--vercel-violet)]" />
        <span className="absolute size-3.5 animate-ping rounded-full border border-[var(--vercel-violet)]/60" />
      </span>
    );
  return (
    <span
      aria-hidden
      className="size-2 rounded-full border border-border bg-transparent"
    />
  );
}
