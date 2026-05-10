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

// Pre-ready auto-retry budget. ~8 attempts × 1.5s ≈ 12s of grace, which
// comfortably covers a cold container booting Xvfb + XFCE + x11vnc +
// websockify on a typical laptop. Past that, we surface a real error so
// the user can retry manually if the VM is genuinely stuck.
const MAX_AUTO_ATTEMPTS = 8;
const AUTO_RETRY_DELAY_MS = 1500;

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
  // Tracks whether RFB has ever reached "connected" since the last manual
  // reconnect. Used to distinguish a genuine post-ready disconnect (real
  // error worth surfacing) from a fresh container that simply isn't ready
  // to serve websockify yet.
  const [hasEverConnected, setHasEverConnected] = useState(false);
  // Counts auto-retries while we're still in the pre-ready boot window.
  // Capped to eventually surface a real error if the VM never comes up.
  const [autoAttempts, setAutoAttempts] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // Ensure the boot-loader stays visible long enough to feel intentional even
  // when the VM connects fast. Reset on reconnect. The initial reset is
  // deferred out of the effect body to satisfy React 19's
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let cancelled = false;
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
        tl.from("[data-anim='header']", { y: -8, opacity: 0, duration: 0.45 });
        tl.from(
          "[data-anim='stage']",
          { y: 18, opacity: 0, duration: 0.6 },
          "-=0.25",
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
    if (s === "connected") setHasEverConnected(true);
  }, []);

  const onReconnect = useCallback(() => {
    setHasEverConnected(false);
    setAutoAttempts(0);
    setReconnectKey((k) => k + 1);
  }, []);

  // Pre-ready VM: websockify isn't always listening the moment the
  // container starts (Xvfb → XFCE → x11vnc → websockify is sequential in
  // entrypoint.sh). The first few RFB disconnects therefore aren't
  // failures — they're just "VM still booting". Silently re-mount the
  // viewer until either it connects or we exhaust the budget.
  useEffect(() => {
    if (status !== "error" && status !== "disconnected") return;
    if (hasEverConnected) return;
    if (autoAttempts >= MAX_AUTO_ATTEMPTS) return;
    const id = window.setTimeout(() => {
      setAutoAttempts((n) => n + 1);
      setReconnectKey((k) => k + 1);
    }, AUTO_RETRY_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [status, hasEverConnected, autoAttempts]);

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

  // Only treat a failure as a hard error once the VM has either:
  //   (a) been live at least once this session (post-ready disconnect), or
  //   (b) blown through the silent pre-ready auto-retry budget.
  // Until then, the boot loader's normal progressive checklist tells the
  // story — a red "Connection failed" block during a normal cold boot is
  // misleading, since nothing is actually broken.
  const isHardFailure =
    (status === "error" || status === "disconnected") &&
    (hasEverConnected || autoAttempts >= MAX_AUTO_ATTEMPTS);

  const errorMsg = isHardFailure
    ? status === "error"
      ? statusMsg ?? "Connection error"
      : statusMsg ?? "Disconnected"
    : null;

  return (
    <main
      ref={root}
      className="relative flex h-full w-full flex-col overflow-hidden bg-transparent text-ink"
    >
      {/* Top bar lives in the page chrome, not over the desktop. */}
      <div data-anim="header" className="relative z-30">
        <ConsoleHeader vm={vm} status={status} size={size} />
      </div>

      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 sm:px-6 sm:py-4 lg:px-10 lg:py-6"
        style={{ containerType: "size" }}
      >
        {/* Folio in the gutter — only visible on lg+ where there's room. */}
        <div
          aria-hidden
          className="absolute left-3 top-1/2 hidden -translate-y-1/2 origin-left -rotate-90 lg:block"
        >
          <span className="folio whitespace-nowrap">
            VM · Live framebuffer · 16/9
          </span>
        </div>
        <div
          aria-hidden
          className="absolute right-3 top-1/2 hidden -translate-y-1/2 origin-right rotate-90 lg:block"
        >
          <span className="folio whitespace-nowrap">
            {vm.label || vm.name}
          </span>
        </div>

        <div
          data-anim="stage"
          data-active={showBoot ? "true" : undefined}
          className={cn(
            "relative overflow-hidden bg-paper",
            "border border-rule shadow-[0_30px_60px_-22px_rgba(10,10,10,0.22)]",
          )}
          style={{
            width: "min(100%, calc(100cqh * 16 / 9))",
            height: "min(100%, calc(100cqw * 9 / 16))",
          }}
        >
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
          style={{ bottom: shellOpen ? "calc(60% + 12px)" : "16px" }}
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
          <div className="pointer-events-none absolute bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-[2px] border border-rule bg-paper/95 px-3 py-1.5 text-[12px] font-medium text-ink shadow-[0_18px_30px_-22px_rgba(10,10,10,0.32)] backdrop-blur">
            {toast}
          </div>
        )}
      </div>
    </main>
  );
}
