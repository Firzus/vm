"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useOnboarding } from "@/lib/use-onboarding";
import { useGsapReveal } from "@/components/visuals/use-gsap-reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WelcomeStep } from "./steps/welcome";
import { CreateVmStep } from "./steps/create-vm";
import { DockTourStep } from "./steps/dock-tour";
import { ApiMcpStep } from "./steps/api-mcp";
import { DoneStep } from "./steps/done";

export type StepProps = {
  goNext: () => void;
  goPrev: () => void;
  complete: () => void;
  index: number;
  total: number;
};

type StepDef = {
  id: string;
  label: string;
  Component: ComponentType<StepProps>;
};

const STEPS: StepDef[] = [
  { id: "welcome", label: "Welcome", Component: WelcomeStep },
  { id: "create", label: "Create", Component: CreateVmStep },
  { id: "dock", label: "Dock", Component: DockTourStep },
  { id: "api", label: "API & MCP", Component: ApiMcpStep },
  { id: "done", label: "Done", Component: DoneStep },
];

/**
 * Globally-mounted onboarding host. Controls open/closed state via
 * useOnboarding (a localStorage-backed hook). Renders nothing until the
 * client has hydrated, to avoid SSR/CSR mismatches over the modal's
 * presence.
 */
export function OnboardingHost() {
  const { hydrated, open, close, complete } = useOnboarding();

  if (!hydrated || !open) return null;
  return <OnboardingModal onClose={close} onComplete={complete} />;
}

function OnboardingModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, []);
  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Keyboard: Esc closes, ←/→ navigates, Enter on last step completes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (index === STEPS.length - 1) onComplete();
        else goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, goNext, goPrev, onClose, onComplete]);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Touch-swipe navigation between steps.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touchStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || e.pointerType !== "touch") return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && index < STEPS.length - 1) goNext();
    else if (dx > 0 && index > 0) goPrev();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="VM Console — editorial tour"
      className="fixed inset-0 z-[200] flex items-stretch justify-center"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* Paper backdrop with a hint of vermilion. */}
      <div className="absolute inset-0 bg-paper/95 backdrop-blur-md" aria-hidden />
      <div className="paper-noise" aria-hidden />

      <div
        ref={containerRef}
        className="relative flex h-full w-full max-w-7xl flex-col"
      >
        {/* Top bar — folio + close. */}
        <header className="safe-top relative flex items-center justify-between gap-3 border-b border-rule px-4 py-3 md:px-8 md:py-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="seal" />
            <span className="folio">VM Console — Editorial Tour</span>
          </div>
          <Stepper index={index} onGo={setIndex} />
          <button
            type="button"
            aria-label="Close tour"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-[2px] text-ink-muted transition hover:text-vermilion focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Step content. The whole step is keyed by index so animations and
            internal step-state reset cleanly between transitions. */}
        <StepStage key={index} index={index} total={STEPS.length}>
          {(() => {
            const Component = STEPS[index].Component;
            return (
              <Component
                index={index}
                total={STEPS.length}
                goNext={goNext}
                goPrev={goPrev}
                complete={onComplete}
              />
            );
          })()}
        </StepStage>

        {/* Bottom navigation. */}
        <footer className="safe-bottom flex items-center justify-between gap-3 border-t border-rule px-4 py-3 md:px-8 md:py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={goPrev}
            disabled={index === 0}
            className="gap-1"
          >
            <ChevronLeft className="size-3.5" />
            Previous
          </Button>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(STEPS.length).padStart(2, "0")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={index === STEPS.length - 1 ? onComplete : goNext}
            className="gap-1"
          >
            {index === STEPS.length - 1 ? "Finish" : "Next"}
            <ChevronRight className="size-3.5" />
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Stepper({
  index,
  onGo,
}: {
  index: number;
  onGo: (i: number) => void;
}) {
  return (
    <ol className="hidden items-center gap-2 md:flex">
      {STEPS.map((s, i) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onGo(i)}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "relative flex items-center gap-1.5 rounded-[2px] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition",
              i === index ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "inline-block size-1.5 rounded-full transition-colors",
                i === index
                  ? "bg-vermilion"
                  : i < index
                    ? "bg-ink"
                    : "bg-rule-strong",
              )}
            />
            {String(i + 1).padStart(2, "0")} {s.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

function StepStage({
  index,
  total,
  children,
}: {
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  // Stagger every [data-reveal] element on mount.
  const ref = useGsapReveal<HTMLDivElement>({ stagger: 0.05, y: 12 });
  void total;
  void index;
  return (
    <div className="flex-1 overflow-y-auto">
      <div
        ref={ref}
        className="mx-auto h-full w-full max-w-7xl px-4 py-6 md:px-8 md:py-10"
      >
        {children}
      </div>
    </div>
  );
}
