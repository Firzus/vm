"use client";

import { Button } from "@/components/ui/button";
import { openOnboarding } from "@/lib/use-onboarding";

/**
 * MobileGate — covers the viewport on phones (< sm). The console is too
 * dense to use without a real keyboard / pointer + a 16:9 area, so we
 * lean into it: greet visitors with a tasteful editorial cover and let
 * them open the onboarding tour, which is laid out for narrow viewports.
 *
 * Above sm (640px), the gate is `hidden`; the children render normally.
 */
export function MobileGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="hidden h-full w-full sm:block">{children}</div>

      <section
        className="safe-top safe-bottom flex h-full w-full flex-col justify-between px-6 py-8 sm:hidden"
        aria-label="VM Console — viewport notice"
      >
        <header className="flex items-center justify-between">
          <span className="folio">VM Console</span>
          <span className="folio">Vol. I · Issue 01</span>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-7 py-8">
          <span
            aria-hidden
            className="numeral-display text-[clamp(140px,55vw,260px)]"
          >
            VM
          </span>
          <div className="space-y-3">
            <h1 className="serif-roman text-[clamp(28px,8vw,40px)] leading-[1.05] tracking-tight text-ink">
              <span className="serif">Made for a wider</span> sheet of paper.
            </h1>
            <p className="text-[14px] leading-relaxed text-ink-muted">
              VM Console is a multi-window control surface built around live
              16:9 desktops. It works best on a tablet held landscape, a
              laptop, or any larger screen. Open this URL on one of those —
              the rest of the magazine is waiting.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={() => openOnboarding()}
            className="w-full"
          >
            Read the editorial tour
          </Button>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            5 chapters · works fine on this phone
          </p>
        </div>
      </section>
    </>
  );
}
