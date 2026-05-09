"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ConsoleHeader } from "@/components/console/header";
import { BootLoader } from "@/components/console/boot-loader";
import { Dock } from "@/components/console/dock";
import { ShellDrawer } from "@/components/console/shell-drawer";
import { createVmClient } from "@/lib/vm-client";
import type { VncStatus } from "@/components/vnc-viewer";
import type { Vm } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const VncViewer = dynamic(
  () => import("@/components/vnc-viewer").then((m) => m.VncViewer),
  { ssr: false },
);

type Props = {
  vm: Vm;
};

/**
 * Single-VM console: noVNC viewer + dock + shell drawer + status header,
 * scoped to one specific VM. Multiple instances can render in parallel
 * inside <Tabs>; each one mounts its own RFB connection.
 */
export function VmConsole({ vm }: Props) {
  const wsPath = `/api/vm/${encodeURIComponent(vm.id)}/novnc`;
  const client = useMemo(() => createVmClient(vm.id), [vm.id]);

  const [status, setStatus] = useState<VncStatus>("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [reconnectKey, setReconnectKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [bootMinElapsed, setBootMinElapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Ensure the boot-loader stays visible long enough to feel intentional even
  // when the VM connects fast. Reset on reconnect.
  useEffect(() => {
    let cancelled = false;
    // Synchronous reset of the boot timer would trigger a cascading render —
    // schedule the flip on the microtask queue instead.
    queueMicrotask(() => {
      if (!cancelled) setBootMinElapsed(false);
    });
    const id = setTimeout(() => {
      if (!cancelled) setBootMinElapsed(true);
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [reconnectKey]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // GSAP entrance — single, well-orchestrated reveal.
  useEffect(() => {
    let cancelled = false;
    let ctx: { revert: () => void } | undefined;
    (async () => {
      const { default: gsap } = await import("gsap");
      if (cancelled || !root.current) return;
      ctx = gsap.context(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.from("[data-anim='header']", { y: -8, opacity: 0, duration: 0.4 });
        tl.from(
          "[data-anim='stage']",
          { y: 18, scale: 0.985, opacity: 0, duration: 0.6 },
          "-=0.2",
        );
        tl.from(
          "[data-anim='dock']",
          { y: 14, opacity: 0, duration: 0.5 },
          "-=0.3",
        );
      }, root);
    })();
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const handleStatus = useCallback((s: VncStatus, msg?: string) => {
    setStatus(s);
    setStatusMsg(msg ?? null);
  }, []);

  const onReconnect = useCallback(() => setReconnectKey((k) => k + 1), []);

  const onScreenshot = useCallback(() => {
    const a = document.createElement("a");
    a.href = client.screenshotUrl();
    a.download = `vm-${vm.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flash("Screenshot saved");
  }, [client, vm.id, flash]);

  const onRestart = useCallback(async () => {
    try {
      await client.shell(
        "pkill -KILL -u root xfce4-session xfwm4 xfce4-panel xfdesktop plank thunar 2>/dev/null; sleep 1; DISPLAY=:1 nohup dbus-launch --exit-with-session startxfce4 >/var/log/vm/xfce.log 2>&1 &",
        15,
      );
      flash("Session restarted");
      window.setTimeout(onReconnect, 900);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Restart failed");
    }
  }, [client, flash, onReconnect]);

  const onToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      root.current?.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  // Keyboard: Cmd/Ctrl-J toggles shell drawer, Cmd/Ctrl-S saves screenshot.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        setShellOpen((o) => !o);
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        onScreenshot();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onScreenshot]);

  const showBoot =
    !bootMinElapsed ||
    status === "idle" ||
    status === "connecting" ||
    status === "error" ||
    status === "disconnected";

  const errorMsg =
    status === "error"
      ? statusMsg ?? "Connection error"
      : status === "disconnected" && bootMinElapsed
      ? statusMsg ?? "Disconnected"
      : null;

  return (
    <main
      ref={root}
      className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground spotlight"
    >
      {/* Hairline grid wash — Vercel signature ambient layer */}
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-100" />

      {/* Top bar lives in the page chrome, not over the desktop. */}
      <div data-anim="header" className="relative z-30">
        <ConsoleHeader vm={vm} status={status} size={size} />
      </div>

      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 sm:px-6 lg:px-8 py-4"
        style={{ containerType: "size" }}
      >
        <div
          data-anim="stage"
          data-active={showBoot ? "true" : undefined}
          className={cn(
            "relative overflow-hidden bg-card",
            "border-shimmer",
          )}
          style={{
            width: "min(100%, calc(100cqh * 16 / 9))",
            height: "min(100%, calc(100cqw * 9 / 16))",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 border border-border"
          />

          <VncViewer
            key={reconnectKey}
            wsPath={wsPath}
            onStatusChange={handleStatus}
            onResize={setSize}
          />

          <BootLoader
            active={showBoot}
            errorMessage={errorMsg}
            onRetry={onReconnect}
          />

          <ShellDrawer
            open={shellOpen}
            onClose={() => setShellOpen(false)}
            vmId={vm.id}
          />
        </div>

        <div
          data-anim="dock"
          className="pointer-events-none absolute inset-x-0 z-40 flex justify-center transition-all duration-300"
          style={{ bottom: shellOpen ? "calc(42% + 12px)" : "16px" }}
        >
          <Dock
            onScreenshot={onScreenshot}
            onReconnect={onReconnect}
            onRestart={onRestart}
            onToggleTerminal={() => setShellOpen((o) => !o)}
            onToggleFullscreen={onToggleFullscreen}
            fullscreen={fullscreen}
            terminalOpen={shellOpen}
            disabled={status !== "connected"}
          />
        </div>

        {toast && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card/95 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-lg backdrop-blur">
            {toast}
          </div>
        )}
      </div>
    </main>
  );
}
