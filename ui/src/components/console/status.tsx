"use client";

import { cn } from "@/lib/utils";
import type { VncStatus } from "@/components/vnc-viewer";

const TONE: Record<VncStatus, string> = {
  idle: "text-muted-foreground",
  connecting: "text-[var(--warning)]",
  connected: "text-[var(--success)]",
  disconnected: "text-muted-foreground",
  error: "text-destructive",
};

const LABEL: Record<VncStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Live",
  disconnected: "Offline",
  error: "Error",
};

export function StatusGlyph({
  status,
  className,
}: {
  status: VncStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[12px] font-medium",
        TONE[status],
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex",
          (status === "connected" || status === "connecting") && "dot-pulse",
        )}
      >
        <span className="dot" />
      </span>
      {LABEL[status]}
    </span>
  );
}
