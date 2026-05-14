#!/usr/bin/env node

const DEFAULTS = {
  total: 6,
  concurrency: 2,
  url: "https://operagx.gg/Huzounetaff",
  labelPrefix: "download-parallel-codex",
  controller: "http://127.0.0.1:3000",
  pageLoadWaitMs: null,
};

const COOKIE_ACCEPT = { x: 735, y: 983 };
const DOWNLOAD_BUTTON = { x: 475, y: 447 };
const MIN_DEB_BYTES = 100 * 1024 * 1024;

class RunnerError extends Error {
  constructor(message, { global = false, screenshotUrl = null } = {}) {
    super(message);
    this.name = "RunnerError";
    this.global = global;
    this.screenshotUrl = screenshotUrl;
  }
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    i += 1;

    switch (key) {
      case "total":
        opts.total = parsePositiveInt(value, key);
        break;
      case "concurrency":
        opts.concurrency = parsePositiveInt(value, key);
        break;
      case "url":
        opts.url = value;
        break;
      case "label-prefix":
        opts.labelPrefix = value;
        break;
      case "controller":
        opts.controller = value.replace(/\/+$/, "");
        break;
      case "page-load-wait-ms":
        opts.pageLoadWaitMs = parsePositiveInt(value, key);
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  if (opts.concurrency > opts.total) opts.concurrency = opts.total;
  return opts;
}

function parsePositiveInt(value, key) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function elapsedSeconds(startedAt) {
  return Math.round((Date.now() - startedAt) / 1000);
}

function log(run, event, details = {}) {
  const fields = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  console.log(`[run ${run}] ${event}${fields ? ` ${fields}` : ""}`);
}

async function requestJson(opts, method, path, { body, timeoutMs = 120_000 } = {}) {
  const url = `${opts.controller}${path}`;
  let res;
  try {
    res = await fetchWithTimeout(url, {
      method,
      timeoutMs,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new RunnerError(
      `controller request failed (${method} ${path}): ${err.message}`,
      { global: true },
    );
  }

  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { text };
    }
  }

  if (!res.ok) {
    const message = parsed?.error || parsed?.detail || text || res.statusText;
    const isGlobal =
      res.status >= 500 ||
      String(message).includes("Concurrent VM limit reached") ||
      String(message).includes("No free");
    throw new RunnerError(
      `controller returned ${res.status} for ${method} ${path}: ${formatMessage(message)}`,
      { global: isGlobal },
    );
  }

  return parsed ?? {};
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`timeout after ${init.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function formatMessage(message) {
  if (typeof message === "string") return message;
  return JSON.stringify(message);
}

function vmPath(vmId, path) {
  return `/api/vm/${encodeURIComponent(vmId)}/${path}`;
}

async function vmGet(opts, vmId, path, timeoutMs = 120_000) {
  return requestJson(opts, "GET", vmPath(vmId, path), { timeoutMs });
}

async function vmPost(opts, vmId, path, body = undefined, timeoutMs = 120_000) {
  return requestJson(opts, "POST", vmPath(vmId, path), { body, timeoutMs });
}

async function vmShell(opts, vmId, cmd, timeout = 60) {
  return vmPost(opts, vmId, "shell", { cmd, timeout }, Math.max(120_000, (timeout + 30) * 1000));
}

async function captureScreenshot(opts, vmId) {
  const path = vmPath(vmId, `screenshot?ts=${Date.now()}`);
  const url = `${opts.controller}${path}`;
  try {
    const res = await fetchWithTimeout(url, { method: "GET", timeoutMs: 30_000 });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    await res.arrayBuffer();
    return url;
  } catch (err) {
    return `${url} (capture failed: ${err.message})`;
  }
}

async function waitForHealth(opts, run, vmId) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const health = await vmGet(opts, vmId, "health", 10_000);
      if (health.status === "ok") {
        log(run, "health-ok", { vm: vmId });
        return;
      }
    } catch (err) {
      if (attempt === 30) throw err;
    }
    await sleep(2_000);
  }
  throw new RunnerError(`VM ${vmId} health did not become ok`);
}

async function click(opts, vmId, point) {
  await vmPost(opts, vmId, "click", {
    x: point.x,
    y: point.y,
    button: "left",
    clicks: 1,
  }, 20_000);
}

function pageLoadWaitMs(opts) {
  if (opts.pageLoadWaitMs) return opts.pageLoadWaitMs;
  return Math.min(30_000, Math.max(10_000, opts.concurrency * 3_000));
}

async function triggerWebsiteDownload(opts, run, vmId, phase) {
  await captureScreenshot(opts, vmId);
  await click(opts, vmId, COOKIE_ACCEPT);
  log(run, phase === "retry" ? "reclicked-cookie" : "clicked-cookie", { vm: vmId });

  await sleep(1_000);
  await vmShell(opts, vmId, "xdotool key Page_Down", 10);
  await sleep(2_000);
  await captureScreenshot(opts, vmId);

  await click(opts, vmId, DOWNLOAD_BUTTON);
  log(run, phase === "retry" ? "reclicked-download" : "clicked-download", { vm: vmId });
}

async function waitForDownload(opts, run, vmId) {
  let sawDownloadStart = false;

  for (let attempt = 1; attempt <= 80; attempt += 1) {
    if (!sawDownloadStart && attempt > 1 && attempt % 12 === 1) {
      await triggerWebsiteDownload(opts, run, vmId, "retry");
    }

    const listing = await vmShell(
      opts,
      vmId,
      "ls -la /root/Downloads; find /root/Downloads -maxdepth 1 -type f -printf '%s %p\\n'",
      10,
    );
    const stdout = String(listing.stdout ?? "");
    const hasCrdownload = stdout.includes(".crdownload");

    if ((hasCrdownload || stdout.includes(".deb")) && !sawDownloadStart) {
      sawDownloadStart = true;
      log(run, "download-started", { vm: vmId });
    }

    if (hasCrdownload) {
      await sleep(3_000);
      continue;
    }

    const newest = await vmShell(
      opts,
      vmId,
      "find /root/Downloads -maxdepth 1 -type f -name '*.deb' -printf '%T@ %s %p\\n' | sort -nr | head -1",
      10,
    );
    const line = String(newest.stdout ?? "").trim();
    if (line) {
      const parts = line.split(" ");
      if (parts.length >= 3) {
        const size = Number.parseInt(parts[1], 10);
        const filePath = parts.slice(2).join(" ");
        if (size > MIN_DEB_BYTES) {
          log(run, "download-complete", { vm: vmId, bytes: size, path: filePath });
          return { path: filePath, bytes: size };
        }
      }
    }

    await sleep(3_000);
  }

  const screenshotUrl = await captureScreenshot(opts, vmId);
  throw new RunnerError("download did not complete", {
    global: true,
    screenshotUrl,
  });
}

async function validateDeb(opts, run, vmId, download) {
  const magic = await vmShell(
    opts,
    vmId,
    `head -c 8 ${quote(download.path)} | od -An -c | head -1`,
    10,
  );
  const stdout = String(magic.stdout ?? "");
  if (!/!\s*<\s*a\s*r\s*c\s*h\s*>/.test(stdout)) {
    throw new RunnerError(`invalid deb magic: ${stdout.trim()}`);
  }
  log(run, "validated", { vm: vmId });
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function deleteVm(opts, run, vmId) {
  await requestJson(
    opts,
    "DELETE",
    `/api/vms/${encodeURIComponent(vmId)}?wipe=1`,
    { timeoutMs: 120_000 },
  );
  log(run, "deleted", { vm: vmId });
}

async function runOne(opts, run) {
  const startedAt = Date.now();
  let vmId = null;
  let result = null;

  log(run, "queued");

  try {
    const created = await requestJson(opts, "POST", "/api/vms", {
      body: { label: `${opts.labelPrefix}-${run}` },
      timeoutMs: 180_000,
    });
    vmId = created.vm.id;
    log(run, "created", { vm: vmId });

    await waitForHealth(opts, run, vmId);

    const launchName = `google-chrome --no-sandbox --ignore-certificate-errors ${opts.url}`;
    await requestJson(
      opts,
      "POST",
      `${vmPath(vmId, "launch")}?name=${encodeURIComponent(launchName)}`,
      { timeoutMs: 30_000 },
    );
    await sleep(pageLoadWaitMs(opts));

    await triggerWebsiteDownload(opts, run, vmId, "initial");

    const download = await waitForDownload(opts, run, vmId);
    await validateDeb(opts, run, vmId, download);

    result = {
      run,
      vm: vmId,
      status: "pass",
      seconds: elapsedSeconds(startedAt),
      bytes: download.bytes,
    };
    log(run, "pass", { vm: vmId, seconds: result.seconds });
    return result;
  } catch (err) {
    const screenshotUrl = vmId ? await captureScreenshot(opts, vmId) : null;
    result = {
      run,
      vm: vmId,
      status: "fail",
      seconds: elapsedSeconds(startedAt),
      error: err.message,
      screenshotUrl: err.screenshotUrl ?? screenshotUrl,
      global: Boolean(err.global),
    };
    log(run, "fail", {
      vm: vmId,
      seconds: result.seconds,
      error: result.error,
      screenshotUrl: result.screenshotUrl,
    });
    return result;
  } finally {
    if (vmId) {
      try {
        await deleteVm(opts, run, vmId);
      } catch (err) {
        log(run, "delete-failed", { vm: vmId, error: err.message });
        if (result) {
          result.cleanupError = err.message;
        }
      }
    }
  }
}

async function runPool(opts) {
  const results = [];
  let nextRun = 1;
  let active = 0;
  let stopLaunching = false;

  return new Promise((resolve) => {
    const launchMore = () => {
      while (!stopLaunching && active < opts.concurrency && nextRun <= opts.total) {
        const run = nextRun;
        nextRun += 1;
        active += 1;
        runOne(opts, run)
          .then((result) => {
            results.push(result);
            if (result.global) stopLaunching = true;
          })
          .catch((err) => {
            results.push({
              run,
              vm: null,
              status: "fail",
              seconds: 0,
              error: err.message,
              global: true,
            });
            stopLaunching = true;
          })
          .finally(() => {
            active -= 1;
            if ((nextRun > opts.total || stopLaunching) && active === 0) {
              resolve(results.sort((a, b) => a.run - b.run));
            } else {
              launchMore();
            }
          });
      }
    };

    launchMore();
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  await requestJson(opts, "GET", "/api/vms", { timeoutMs: 10_000 });
  const results = await runPool(opts);
  const finalListing = await requestJson(opts, "GET", "/api/vms", { timeoutMs: 10_000 });
  const summary = {
    totalRequested: opts.total,
    concurrency: opts.concurrency,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    remainingVms: Array.isArray(finalListing.vms) ? finalListing.vms.length : null,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0 || summary.remainingVms !== 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
