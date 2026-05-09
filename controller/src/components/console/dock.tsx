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

/**
 * Editorial dock: a paper card with hairline rule, ink icons, and a
 * vermilion underline that traces under the active item. Sits at the
 * bottom of the viewer; collapses to icon-only on small screens.
 */
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
        "pointer-events-auto inline-flex items-center gap-1 px-2 py-1.5",
        "rounded-[3px] border border-rule bg-paper/95 text-ink",
        "shadow-[0_18px_30px_-22px_rgba(10,10,10,0.32)] backdrop-blur",
        "safe-bottom",
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

      <span className="mx-0.5 h-4 w-px bg-rule" aria-hidden />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            aria-label="Restart desktop session"
            className="group inline-flex h-8 items-center gap-1.5 rounded-[2px] px-2 text-[12px] text-ink/75 transition hover:text-vermilion"
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
              variant="destructive"
              onClick={() => void onRestart()}
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <span className="mx-0.5 h-4 w-px bg-rule" aria-hidden />

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
            "relative inline-flex h-8 items-center gap-1.5 rounded-[2px] px-2 text-ink/75 transition",
            "hover:text-ink",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            // The "active" state — vermilion underline under the icon.
            "after:absolute after:inset-x-2 after:-bottom-0.5 after:h-[1.5px] after:bg-vermilion after:scale-x-0 after:origin-left after:transition-transform after:duration-300",
            active && "text-ink after:scale-x-100",
          )}
        >
          {children}
          {kbd && (
            <kbd className="ml-0.5 hidden rounded-[2px] border border-rule bg-paper-2 px-1 font-mono text-[10px] text-ink-muted sm:inline">
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
