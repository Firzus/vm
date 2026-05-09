"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { createVmClient } from "@/lib/vm-client";
import { cn } from "@/lib/utils";

type Line = { id: number; kind: "in" | "out" | "err" | "sys"; text: string };
let counter = 0;
const nextId = () => ++counter;

type Props = {
  open: boolean;
  onClose: () => void;
  vmId: string;
};

export function ShellDrawer({ open, onClose, vmId }: Props) {
  const client = useMemo(() => createVmClient(vmId), [vmId]);
  const [lines, setLines] = useState<Line[]>(() => [
    {
      id: nextId(),
      kind: "sys",
      text:
        `Connected to /api/vm/${vmId}/shell — commands run in the VM container as root.`,
    },
  ]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let ctx: { revert: () => void } | undefined;
    (async () => {
      const { default: gsap } = await import("gsap");
      if (cancelled || !root.current) return;
      ctx = gsap.context(() => {
        gsap.from(root.current, {
          y: 30,
          opacity: 0,
          duration: 0.32,
          ease: "power3.out",
        });
      }, root);
      requestAnimationFrame(() => inputRef.current?.focus());
    })();
    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmd.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setLines((p) => [...p, { id: nextId(), kind: "in", text: trimmed }]);
    setCmd("");
    setHistory((h) => [trimmed, ...h].slice(0, 100));
    setHistoryIdx(null);
    try {
      const res = await client.shell(trimmed, 30);
      const out = res.stdout?.trimEnd();
      const err = res.stderr?.trimEnd();
      if (out) setLines((p) => [...p, { id: nextId(), kind: "out", text: out }]);
      if (err) setLines((p) => [...p, { id: nextId(), kind: "err", text: err }]);
      if (!out && !err) {
        setLines((p) => [
          ...p,
          { id: nextId(), kind: "sys", text: `(exit ${res.returncode})` },
        ]);
      }
    } catch (e) {
      setLines((p) => [
        ...p,
        {
          id: nextId(),
          kind: "err",
          text: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const next = historyIdx === null ? 0 : Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      setCmd(history[next]);
    } else if (e.key === "ArrowDown" && historyIdx !== null) {
      e.preventDefault();
      const next = historyIdx - 1;
      if (next < 0) {
        setHistoryIdx(null);
        setCmd("");
      } else {
        setHistoryIdx(next);
        setCmd(history[next]);
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      ref={root}
      className="absolute inset-x-0 bottom-0 z-30 mx-auto h-[42%] max-h-[440px] overflow-hidden rounded-t-md border border-border bg-card/95 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
    >
      <header className="flex h-9 items-center justify-between border-b border-border bg-background/40 px-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{
              background: "var(--vercel-violet)",
              boxShadow: "0 0 8px var(--vercel-violet)",
            }}
          />
          <span className="font-medium text-foreground">Host shell</span>
          <span className="text-foreground/30">·</span>
          <span className="font-mono text-[11px]">{`/api/vm/${vmId}/shell`}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            aria-label="Collapse shell"
            className="grid size-6 place-items-center rounded text-muted-foreground transition hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </button>
          <button
            onClick={onClose}
            aria-label="Close shell"
            className="grid size-6 place-items-center rounded text-muted-foreground transition hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100%-2.25rem)] flex-col">
        <div
          className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed scrollbar-thin"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "whitespace-pre-wrap",
                l.kind === "in" && "text-foreground",
                l.kind === "out" && "text-foreground/85",
                l.kind === "err" && "text-destructive",
                l.kind === "sys" && "text-muted-foreground italic",
              )}
            >
              {l.kind === "in" ? (
                <>
                  <span style={{ color: "var(--vercel-violet)" }}>$</span>{" "}
                  {l.text}
                </>
              ) : (
                l.text
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-border bg-background/30 px-3 py-2 font-mono text-sm"
        >
          <span style={{ color: "var(--vercel-violet)" }}>$</span>
          <input
            ref={inputRef}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder={busy ? "running…" : "ls -la /root"}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="rounded border border-border px-1 text-[10px] text-muted-foreground">
            esc
          </kbd>
        </form>
      </div>
    </div>
  );
}
