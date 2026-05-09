"use client";

import Image from "next/image";
import {
  Camera,
  Maximize2,
  Power,
  RotateCw,
  TerminalSquare,
} from "lucide-react";
import type { StepProps } from "../onboarding";
import { Button } from "@/components/ui/button";

const ROWS: Array<{
  icon: React.ReactNode;
  title: string;
  body: string;
  kbd?: string;
}> = [
  {
    icon: <TerminalSquare className="size-3.5" />,
    title: "Host shell",
    body: "Run any command inside the container. History persists during the session.",
    kbd: "⌘ J",
  },
  {
    icon: <Camera className="size-3.5" />,
    title: "Screenshot",
    body: "Capture the current desktop and save it locally as a PNG.",
    kbd: "⌘ S",
  },
  {
    icon: <RotateCw className="size-3.5" />,
    title: "Reconnect viewer",
    body: "Re-establish the noVNC tunnel without rebooting the desktop.",
  },
  {
    icon: <Power className="size-3.5" />,
    title: "Restart desktop",
    body: "Kill XFCE and start a fresh session — the container keeps running.",
  },
  {
    icon: <Maximize2 className="size-3.5" />,
    title: "Fullscreen",
    body: "Hand the whole window over to the desktop. Esc to come back.",
  },
];

export function DockTourStep({ goNext }: StepProps) {
  return (
    <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
      <figure className="paper-card relative aspect-[4/3] overflow-hidden md:order-1 md:aspect-auto md:h-full">
        <Image
          src="/onboarding/03-dock.png"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
        <figcaption className="folio absolute bottom-3 left-3">
          Plate III · Apparatus
        </figcaption>
      </figure>

      <div className="flex flex-col justify-center gap-6 md:order-2">
        <header className="space-y-2" data-reveal>
          <span className="folio">No. 03 — The dock</span>
          <h2 className="serif-roman text-[clamp(28px,4.5vw,46px)] leading-[1.05] tracking-tight text-ink">
            <span className="serif">Five tools,</span>
            <br />
            one editorial bar.
          </h2>
        </header>

        <p
          className="max-w-xl text-[15px] leading-relaxed text-ink-muted md:text-[16px]"
          data-reveal
        >
          The floating dock at the bottom of every console gathers the things
          you reach for most. Two of them have keyboard shortcuts so the
          desktop stays the centre of attention.
        </p>

        <ul className="space-y-3" data-reveal>
          {ROWS.map((row) => (
            <li
              key={row.title}
              className="flex items-start gap-3 border-b border-rule pb-3 last:border-b-0 last:pb-0"
            >
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[2px] bg-paper-2 text-ink">
                {row.icon}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="serif text-[16px] text-ink">
                    {row.title}
                  </span>
                  {row.kbd && (
                    <kbd className="rounded-[2px] border border-rule bg-paper-2 px-1 font-mono text-[10px] text-ink-muted">
                      {row.kbd}
                    </kbd>
                  )}
                </div>
                <div className="text-[13px] leading-relaxed text-ink-muted">
                  {row.body}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex pt-1" data-reveal>
          <Button variant="primary" size="lg" onClick={goNext}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
