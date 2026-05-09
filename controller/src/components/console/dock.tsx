"use client";

import {
  Camera,
  Maximize2,
  Minimize2,
  Power,
  RotateCw,
  TerminalSquare,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type Props = {
  onScreenshot: () => void;
  onReconnect: () => void;
  onRestart: () => Promise<void>;
  onToggleTerminal: () => void;
  onToggleFullscreen: () => void;
  fullscreen: boolean;
  terminalOpen: boolean;
  disabled?: boolean;
};

export function Dock({
  onScreenshot,
  onReconnect,
  onRestart,
  onToggleTerminal,
  onToggleFullscreen,
  fullscreen,
  terminalOpen,
  disabled,
}: Props) {
  return (
    <div
      role="toolbar"
      aria-label="VM controls"
      className={cn(
        "pointer-events-auto inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-card/80 p-0.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md",
        disabled && "opacity-70",
      )}
    >
      <DockButton
        label="Toggle host shell  ·  ⌘ J"
        active={terminalOpen}
        onClick={onToggleTerminal}
        kbd="J"
      >
        <TerminalSquare className="size-3.5" />
      </DockButton>

      <DockButton
        label="Download screenshot  ·  ⌘ S"
        onClick={onScreenshot}
        disabled={disabled}
      >
        <Camera className="size-3.5" />
      </DockButton>

      <DockButton label="Reconnect viewer" onClick={onReconnect}>
        <RotateCw className="size-3.5" />
      </DockButton>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            aria-label="Restart desktop session"
            className="group inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] text-foreground/75 transition hover:bg-destructive/10 hover:text-destructive"
          >
            <Power className="size-3.5" />
            <span className="hidden text-[12px] sm:inline">Restart</span>
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Restart desktop session?</AlertDialogTitle>
            <AlertDialogDescription>
              The VM container keeps running, but every app currently open in
              the desktop will close. The session reappears in about a second.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onRestart()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <DockButton
        label={fullscreen ? "Exit fullscreen  ·  Esc" : "Fullscreen"}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? (
          <Minimize2 className="size-3.5" />
        ) : (
          <Maximize2 className="size-3.5" />
        )}
      </DockButton>
    </div>
  );
}

function DockButton({
  children,
  label,
  onClick,
  disabled,
  active,
  kbd,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  kbd?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-foreground/75 transition",
            "hover:bg-accent hover:text-foreground",
            active &&
              "bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.12]",
          )}
        >
          {children}
          {kbd && (
            <kbd className="ml-0.5 hidden rounded border border-border bg-background/50 px-1 font-mono text-[10px] text-muted-foreground sm:inline">
              {kbd}
            </kbd>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
