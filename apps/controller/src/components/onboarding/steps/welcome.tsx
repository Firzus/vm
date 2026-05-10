"use client";

import Image from "next/image";
import type { StepProps } from "../onboarding";
import { Button } from "@/components/ui/button";

/**
 * Step 01 — editorial cover. Big numeral on the left, masthead + chapeau
 * on the right. The illustration sits inside a paper card with a folio
 * caption.
 */
export function WelcomeStep({ goNext }: StepProps) {
  return (
    <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
      <figure className="paper-card relative aspect-[4/3] overflow-hidden md:order-1 md:aspect-auto md:h-full">
        <Image
          src="/onboarding/01-welcome.png"
          alt=""
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
        <figcaption className="folio absolute bottom-3 left-3">
          Plate I · Welcome
        </figcaption>
      </figure>

      <div className="flex flex-col justify-center gap-6 md:order-2">
        <header className="space-y-2" data-reveal>
          <span className="folio">No. 01 — Welcome</span>
          <h2 className="serif-roman text-[clamp(32px,5vw,52px)] leading-[1.02] tracking-tight text-ink">
            <span className="serif">A clean machine,</span>
            <br />
            an editorial control surface.
          </h2>
        </header>

        <p
          className="max-w-xl text-[15px] leading-relaxed text-ink-muted md:text-[16px]"
          data-reveal
        >
          VM Console boots disposable Ubuntu desktops in Docker, gives each one
          its own tab, and exposes an HTTP automation API on every container
          so you can drive them by hand or from an AI agent. No noise, no
          cliché — just a quiet workshop for spinning up sandboxes.
        </p>

        <ul
          className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2"
          data-reveal
        >
          {[
            ["Multi-VM", "side-by-side, each in its own tab"],
            ["Isolated", "one Docker container, one volume"],
            ["Driveable", "HTTP API + MCP, no SSH required"],
            ["Reset-friendly", "wipe the volume, start fresh"],
          ].map(([title, body]) => (
            <li
              key={title}
              className="border-l-2 border-rule pl-3 leading-relaxed"
            >
              <div className="serif text-[16px] text-ink">{title}</div>
              <div className="text-ink-muted">{body}</div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3 pt-2" data-reveal>
          <Button variant="primary" size="lg" onClick={goNext} className="gap-2">
            Begin the tour
          </Button>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            5 chapters · ⌘ ←/→ to navigate
          </span>
        </div>
      </div>
    </div>
  );
}
