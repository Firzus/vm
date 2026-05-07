"use client";

import { useEffect, useState } from "react";
import { ExternalLink, BookText } from "lucide-react";
import { StatusGlyph } from "./status";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VM_VNC_HOST, VM_VNC_PORT } from "@/lib/config";
import type { VncStatus } from "@/components/vnc-viewer";

type Props = {
  status: VncStatus;
  size: { width: number; height: number } | null;
};

export function ConsoleHeader({ status, size }: Props) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    };
    fmt();
    const id = setInterval(fmt, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 text-foreground backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[12px] font-semibold tracking-tight">
          VM Console
        </span>
      </div>

      <span className="text-foreground/20">/</span>

      <span className="font-mono text-[11px] text-muted-foreground">
        {VM_VNC_HOST}:{VM_VNC_PORT}
      </span>

      {size && (
        <>
          <span className="text-foreground/20">·</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {size.width}×{size.height}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <StatusGlyph status={status} />
        <span className="text-foreground/20">·</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {time}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noreferrer"
              aria-label="Open API docs"
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <BookText className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom">API documentation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="http://localhost:6080/vnc.html?autoconnect=1&password=agent"
              target="_blank"
              rel="noreferrer"
              aria-label="Open raw noVNC"
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="bottom">Raw noVNC client</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="relative inline-flex size-6 items-center justify-center overflow-hidden rounded-md bg-foreground text-background">
      <svg
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 2 L22 21 L2 21 Z" />
      </svg>
    </span>
  );
}
