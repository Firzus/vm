"use client";

import Image from "next/image";
import { useState } from "react";
import type { StepProps } from "../onboarding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SAMPLES = {
  curl: `# 1. List VMs
curl http://localhost:3000/api/vms

# 2. Take a screenshot of vm "abc"
curl -o screen.png \\
  http://localhost:3000/api/vm/abc/screenshot

# 3. Click at (960, 540)
curl -X POST http://localhost:3000/api/vm/abc/click \\
  -H 'content-type: application/json' \\
  -d '{"x": 960, "y": 540}'

# 4. Run a shell command
curl -X POST http://localhost:3000/api/vm/abc/shell \\
  -H 'content-type: application/json' \\
  -d '{"cmd": "apt-get update && apt-get install -y firefox"}'`,
  mcp: `# Two MCP servers ship with the project (see .mcp.json):

# 1. cursor-vm — full multi-VM lifecycle + per-VM desktop drive
mcp call cursor-vm.create_vm
mcp call cursor-vm.screenshot     vm_id=abc
mcp call cursor-vm.click          vm_id=abc x=960 y=540
mcp call cursor-vm.install_apt    vm_id=abc package=firefox
mcp call cursor-vm.delete_vm      vm_id=abc

# 2. chrome-devtools — connect via cursor-vm.launch_chrome_debug
mcp call cursor-vm.launch_chrome_debug vm_id=abc
# -> { host_cdp_port, chrome_devtools_mcp_url }
# Pass --browserUrl=<url> to chrome-devtools-mcp.`,
};

type Tab = keyof typeof SAMPLES;

export function ApiMcpStep({ goNext }: StepProps) {
  const [tab, setTab] = useState<Tab>("curl");

  return (
    <div className="grid h-full grid-cols-1 gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12 lg:gap-16">
      <figure className="paper-card relative aspect-[4/3] overflow-hidden md:order-1 md:aspect-auto md:h-full">
        <Image
          src="/onboarding/04-api.png"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
        <figcaption className="folio absolute bottom-3 left-3">
          Plate IV · Correspondence
        </figcaption>
      </figure>

      <div className="flex flex-col justify-center gap-6 md:order-2">
        <header className="space-y-2" data-reveal>
          <span className="folio">No. 04 — Drive it from outside</span>
          <h2 className="serif-roman text-[clamp(28px,4.5vw,46px)] leading-[1.05] tracking-tight text-ink">
            <span className="serif">Two ways</span>
            <br />
            to address the machine.
          </h2>
        </header>

        <p
          className="max-w-xl text-[15px] leading-relaxed text-ink-muted md:text-[16px]"
          data-reveal
        >
          Every VM is reachable through the controller proxy at{" "}
          <span className="mono text-ink">/api/vm/&lt;id&gt;/...</span>.
          Use plain HTTP from a script, or hand the same surface to an AI
          agent over MCP.
        </p>

        <div className="paper-card-soft overflow-hidden" data-reveal>
          <div
            role="tablist"
            className="flex items-center gap-1 border-b border-rule bg-paper-2/60 px-2 py-1.5"
          >
            {(["curl", "mcp"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative rounded-[2px] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition",
                  tab === t
                    ? "text-ink after:absolute after:inset-x-2 after:-bottom-[7px] after:h-[1.5px] after:bg-vermilion"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {t === "curl" ? "Shell · curl" : "Agents · MCP"}
              </button>
            ))}
          </div>
          <pre className="max-h-[280px] overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-ink whitespace-pre">
            {SAMPLES[tab]}
          </pre>
        </div>

        <div className="flex pt-1" data-reveal>
          <Button variant="primary" size="lg" onClick={goNext}>
            Final chapter
          </Button>
        </div>
      </div>
    </div>
  );
}
