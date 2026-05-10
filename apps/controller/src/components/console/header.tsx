"use client";

import { useEffect, useState } from "react";
import { ExternalLink, BookText, HelpCircle } from "lucide-react";
import { StatusGlyph } from "./status";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openOnboarding } from "@/lib/use-onboarding";
import type { VncStatus } from "@/components/vnc-viewer";
import type { Vm } from "@/lib/schemas";

type Props = {
  /** Currently visible VM (active tab), or null if no VMs exist yet. */
  vm: Vm | null;
  status: VncStatus;
  size: { width: number; height: number } | null;
};

/**
 * Editorial masthead. Layout from left to right:
 *
 *   [Imprint logo]  VM Console  /  vm-label  ·  api:… vnc:… cdp:…
 *                                                    [status] · [time] [?] [docs] [↗]
 *
 * Hidden on small viewports below md: only the imprint, label, and status
 * survive — folio details (ports, time, secondary actions) come back at md+.
 */
export function ConsoleHeader({ vm, status, size }: Props) {
  const [time, setTime] = useState<string>("");
  const [date, setDate] = useState<string>("");

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      // ISO-ish editorial date — "VOL. XXVI · ISSUE 05.09".
      const month = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      setDate(`Issue ${month}.${day}`);
    };
    fmt();
    const id = setInterval(fmt, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="safe-top relative flex h-12 shrink-0 items-center gap-3 border-b border-rule bg-paper/85 px-4 text-ink backdrop-blur-md md:px-6">
      <div className="flex items-center gap-3">
        <Imprint />
        <span className="serif-roman text-[15px] leading-none tracking-tight md:text-[16px]">
          VM Console
        </span>
      </div>

      <span className="hidden h-3 w-px bg-rule sm:inline-block" />

      {vm ? (
        <>
          <span className="font-mono text-[11px] text-ink truncate max-w-[140px] sm:max-w-none">
            {vm.label || vm.name}
          </span>
          <span className="hidden text-ink-muted/40 md:inline">·</span>
          <span className="hidden font-mono text-[10px] text-ink-muted md:inline">
            api:{vm.ports.api} · vnc:{vm.ports.novnc} · cdp:{vm.ports.cdp}
          </span>
        </>
      ) : (
        <span className="font-mono text-[11px] text-ink-muted">no vm</span>
      )}

      {size && (
        <>
          <span className="hidden text-ink-muted/40 md:inline">·</span>
          <span className="hidden font-mono text-[10px] text-ink-muted lg:inline">
            {size.width}×{size.height}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <StatusGlyph status={status} />
        <span className="hidden h-3 w-px bg-rule md:inline-block" />
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted md:inline">
          {date}
        </span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted md:inline">
          {time}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Show onboarding tour"
              onClick={() => openOnboarding()}
              className="grid size-7 place-items-center rounded-[2px] text-ink-muted transition hover:text-vermilion focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <HelpCircle className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Replay the tour</TooltipContent>
        </Tooltip>

        {vm && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`/api/vm/${encodeURIComponent(vm.id)}/docs`}
                target="_blank"
                rel="noreferrer"
                aria-label="Open VM API docs"
                className="hidden size-7 place-items-center rounded-[2px] text-ink-muted transition hover:text-vermilion sm:grid"
              >
                <BookText className="size-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">VM API documentation</TooltipContent>
          </Tooltip>
        )}
        {vm && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`http://127.0.0.1:${vm.ports.novnc}/vnc.html?autoconnect=1&password=agent`}
                target="_blank"
                rel="noreferrer"
                aria-label="Open raw noVNC for this VM"
                className="hidden size-7 place-items-center rounded-[2px] text-ink-muted transition hover:text-vermilion sm:grid"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">Raw noVNC client</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

function Imprint() {
  // Solid ink triangle inside an ivory disc — the editorial imprint stamp.
  return (
    <span className="relative inline-flex size-7 items-center justify-center overflow-hidden rounded-[2px] bg-ink text-paper">
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 2 L22 21 L2 21 Z" />
      </svg>
      {/* Tiny vermilion seal in the bottom-right corner — wax stamp. */}
      <span
        aria-hidden
        className="absolute -bottom-px -right-px size-[5px] rounded-full bg-vermilion"
      />
    </span>
  );
}
