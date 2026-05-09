"use client";

import { useEffect, useRef } from "react";
import type RFBType from "@novnc/novnc";
import { cn } from "@/lib/utils";
import { VM_VNC_HOST, VM_VNC_PORT, VM_VNC_PASSWORD } from "@/lib/config";

export type VncStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type Props = {
  password?: string;
  onStatusChange?: (status: VncStatus, message?: string) => void;
  onResize?: (size: { width: number; height: number }) => void;
  className?: string;
};

/**
 * Renders the VNC desktop scaled to fit its parent container.
 * The parent is responsible for enforcing a 16:9 aspect ratio so the
 * desktop is letterboxed instead of cropped on resize.
 */
export function VncViewer({
  password = VM_VNC_PASSWORD,
  onStatusChange,
  onResize,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBType | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let cancelled = false;
    let instance: RFBType | null = null;

    const update = (next: VncStatus, message?: string) =>
      !cancelled && onStatusChange?.(next, message);

    update("connecting");

    (async () => {
      try {
        const mod = await import("@novnc/novnc");
        if (cancelled) return;
        const RFB = (mod as unknown as { default: typeof RFBType }).default;

        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = `${proto}://${VM_VNC_HOST}:${VM_VNC_PORT}/websockify`;

        instance = new RFB(node, wsUrl, {
          credentials: { password },
          wsProtocols: ["binary"],
        });

        rfbRef.current = instance;

        // Local scaling: GPU-scale the remote framebuffer to fit our 16:9
        // container. Combined with `clipViewport=false`, this guarantees the
        // desktop is letterboxed inside its parent and never cropped.
        instance.scaleViewport = true;
        instance.resizeSession = false;
        instance.clipViewport = false;
        instance.viewOnly = false;
        instance.background = "transparent";
        // Use the real remote cursor (Bibata, set by xsettings inside the VM)
        // and hide the fallback dot when one isn't reported.
        instance.showDotCursor = false;

        const onConnect = () => {
          update("connected");
          requestAnimationFrame(() => instance?.focus());
        };
        const onDisconnect = (e: Event) => {
          const detail = (e as CustomEvent<{ clean: boolean }>).detail;
          update(
            "disconnected",
            detail?.clean ? "Disconnected" : "Connection lost",
          );
        };
        const onCredentialsRequired = () => update("error", "Wrong password");
        const onSecurityFailure = (e: Event) => {
          const detail = (e as CustomEvent<{ reason?: string }>).detail;
          update("error", detail?.reason ?? "Security failure");
        };
        const onDesktopName = () => {
          if (!node) return;
          // Read the *remote* framebuffer size from the canvas RFB created
          // inside our container, not the container's CSS size.
          const canvas = node.querySelector("canvas");
          if (canvas?.width && canvas?.height) {
            onResize?.({ width: canvas.width, height: canvas.height });
          }
        };

        instance.addEventListener("connect", onConnect);
        instance.addEventListener("disconnect", onDisconnect);
        instance.addEventListener("credentialsrequired", onCredentialsRequired);
        instance.addEventListener("securityfailure", onSecurityFailure);
        instance.addEventListener("desktopname", onDesktopName);
      } catch (err) {
        update("error", err instanceof Error ? err.message : "noVNC failed");
      }
    })();

    return () => {
      cancelled = true;
      try {
        instance?.disconnect();
      } catch {}
      rfbRef.current = null;
      if (node) node.innerHTML = "";
    };
  }, [password, onStatusChange, onResize]);

  return (
    <div
      ref={containerRef}
      className={cn("h-full w-full", className)}
      onClickCapture={() => rfbRef.current?.focus?.()}
    />
  );
}
