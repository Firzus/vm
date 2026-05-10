"use client";

import { cn } from "@/lib/utils";
import type { VncStatus } from "@/components/vnc-viewer";

const TONE: Record<VncStatus, string> = {
  idle: "text-ink-muted",
  connecting: "text-vermilion",
  connected: "text-ink",
  disconnected: "text-ink-muted",
  error: "text-vermilion",
};

const LABEL: Record<VncStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Live",
  disconnected: "Offline",
  error: "Error",
};

const DOT_BG: Record<VncStatus, string> = {
  idle: "bg-rule-strong",
  connecting: "bg-vermilion",
  connected: "bg-vermilion",
  disconnected: "bg-rule-strong",
  error: "bg-vermilion",
};

/**
 * Editorial-Swiss status glyph: ink mono caps + a vermilion seal that
 * pulses while the connection is live. No neon glow — the pulse animation
 * lives entirely in CSS via the `.seal-pulse` class.
 */
export function StatusGlyph({
  status,
  className,
}: {
  status: VncStatus;
  className?: string;
}) {
  const showPulse = status === "connected" || status === "connecting";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]",
        TONE[status],
        className,
      )}
    >
      <span className={cn("relative inline-flex", showPulse && "seal-pulse text-vermilion")}>
        <span
          aria-hidden
          className={cn("inline-block size-[6px] rounded-full", DOT_BG[status])}
        />
      </span>
      {LABEL[status]}
    </span>
  );
}
