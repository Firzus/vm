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

/**
 * Editorial boot loader. A sheet of paper in the middle of the stage,
 * with a serif italic title, mono step list, and a vermilion progress
 * line that traces left-to-right as the connection establishes.
 */
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
    let cancelled = false;
    let i = 0;
    queueMicrotask(() => {
      if (!cancelled) setDone(0);
    });
    const id = setInterval(() => {
      i += 1;
      if (!cancelled) setDone(i);
      if (i >= STEPS.length) clearInterval(id);
    }, 220);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
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
      <div
        aria-hidden
        className="absolute inset-0 bg-paper/85 backdrop-blur-md"
      />

      <div
        className={cn(
          "relative w-[min(440px,calc(100%-2rem))] overflow-hidden p-6",
          "paper-card",
        )}
      >
        {/* Folio bar at the top of the card. */}
        <div className="mb-4 flex items-center justify-between">
          <span className="folio">VM · Boot · 0X-EDT</span>
          <span className="folio">Connecting</span>
        </div>

        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-9 place-items-center bg-ink text-paper">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 2 L22 21 L2 21 Z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="serif-roman text-[18px] leading-tight tracking-tight text-ink">
              Connecting to VM
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
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
                    state === "done" && "text-ink/85",
                    state === "active" && "text-ink",
                    state === "pending" && "text-ink-muted/60",
                  )}
                >
                  {s.label}
                </span>
                <span className="ml-auto text-ink-muted">
                  {state === "done" ? s.target : state === "active" ? "…" : ""}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Vermilion trace line at the bottom of the card. */}
        <div className="relative mt-5 h-[1.5px] overflow-hidden bg-rule">
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-200 ease-out trace-line"
            style={{
              width: `${(done / STEPS.length) * 100}%`,
            }}
          />
        </div>

        {errorMessage && (
          <div className="mt-5 flex items-start gap-2.5 border border-vermilion/30 bg-vermilion/5 px-3 py-2.5 text-[12px] text-vermilion">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex-1">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Connection failed
              </div>
              <div className="mt-0.5 font-mono text-ink/85">
                {errorMessage}
              </div>
              {onRetry && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRetry}
                  className="mt-3 h-7 gap-1.5 border-vermilion/40 px-2 text-[11px] text-vermilion hover:bg-vermilion hover:text-paper"
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
        className="grid size-3.5 place-items-center rounded-full bg-ink"
      >
        <svg
          viewBox="0 0 12 12"
          className="size-2"
          fill="none"
          stroke="var(--paper)"
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
        <span className="absolute size-2 rounded-full bg-vermilion" />
        <span className="absolute size-3.5 animate-ping rounded-full border border-vermilion/60" />
      </span>
    );
  return (
    <span
      aria-hidden
      className="size-2 rounded-full border border-rule bg-transparent"
    />
  );
}
