"use client";

import Image from "next/image";
import { HelpCircle } from "lucide-react";
import type { StepProps } from "../onboarding";
import { Button } from "@/components/ui/button";

export function DoneStep({ complete }: StepProps) {
  return (
    <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
      <figure className="paper-card relative aspect-[4/3] overflow-hidden md:order-1 md:aspect-auto md:h-full">
        <Image
          src="/onboarding/05-done.png"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
        <figcaption className="folio absolute bottom-3 left-3">
          Plate V · Imprint
        </figcaption>
      </figure>

      <div className="flex flex-col justify-center gap-6 md:order-2">
        <header className="space-y-2" data-reveal>
          <span className="folio">No. 05 — End of issue</span>
          <h2 className="serif-roman text-[clamp(28px,4.5vw,46px)] leading-[1.05] tracking-tight text-ink">
            <span className="serif">That&rsquo;s the issue.</span>
            <br />
            The desktop is yours.
          </h2>
        </header>

        <p
          className="max-w-xl text-[15px] leading-relaxed text-ink-muted md:text-[16px]"
          data-reveal
        >
          You can come back to this tour at any time using the{" "}
          <HelpCircle
            aria-hidden
            className="inline size-3.5 -translate-y-px"
          />{" "}
          icon in the top header. Each VM stays alive across page reloads —
          Docker is the source of truth, the controller just keeps an eye on
          it.
        </p>

        <ul
          className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-3"
          data-reveal
        >
          {[
            ["⌘ J", "Toggle host shell"],
            ["⌘ S", "Save screenshot"],
            ["Esc", "Exit fullscreen"],
          ].map(([key, label]) => (
            <li
              key={key}
              className="border border-rule bg-paper-2/60 px-3 py-2.5"
            >
              <kbd className="font-mono text-[11px] tracking-widest text-ink">
                {key}
              </kbd>
              <div className="text-ink-muted">{label}</div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-3 pt-2" data-reveal>
          <Button
            variant="primary"
            size="lg"
            onClick={complete}
            className="gap-2"
          >
            Open the console
          </Button>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Editorial Swiss · Issue I
          </span>
        </div>
      </div>
    </div>
  );
}
