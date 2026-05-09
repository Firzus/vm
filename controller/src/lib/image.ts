/**
 * Ensures the VM Docker image is present locally. Built from the repo's
 * Dockerfile (see VM_REPO_DIR) the first time the controller boots — or
 * whenever the user passes `?rebuild=1` on `/api/vms`.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { env } from "./env";
import { getDocker } from "./docker";

let buildPromise: Promise<void> | null = null;
/** True while a build is in flight; surfaced to the UI for "preparing image…". */
export const imageBuildState = {
  building: false,
  lastLog: "" as string,
  error: null as string | null,
};

async function imageExists(tag: string): Promise<boolean> {
  try {
    await getDocker().getImage(tag).inspect();
    return true;
  } catch {
    return false;
  }
}

async function listBuildContextFiles(repoDir: string): Promise<string[]> {
  // Conservative whitelist: only files actually referenced by the Dockerfile.
  // Listing too broadly (e.g. node_modules of the controller) makes the
  // dockerode buildImage upload slow and pointless.
  const candidates = [
    "Dockerfile",
    ".dockerignore",
    "entrypoint.sh",
    "automation",
    "theme",
    "chrome",
  ];
  const out: string[] = [];
  for (const c of candidates) {
    const full = path.join(repoDir, c);
    try {
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        for await (const f of walk(full, repoDir)) out.push(f);
      } else {
        out.push(c);
      }
    } catch {
      // missing optional path
    }
  }
  return out;
}

async function* walk(dir: string, base: string): AsyncGenerator<string> {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(abs, base);
    } else if (ent.isFile()) {
      yield path.relative(base, abs).replace(/\\/g, "/");
    }
  }
}

async function build(rebuild = false): Promise<void> {
  const tag = env.VM_IMAGE;
  const repoDir = env.VM_REPO_DIR!;
  const dockerfile = path.join(repoDir, "Dockerfile");
  try {
    await fs.access(dockerfile);
  } catch {
    throw new Error(
      `VM Dockerfile not found at ${dockerfile}. Set VM_REPO_DIR to the repo root.`,
    );
  }

  imageBuildState.building = true;
  imageBuildState.error = null;
  imageBuildState.lastLog = "";
  console.log(`[image] building ${tag} from ${repoDir} ...`);

  const src = await listBuildContextFiles(repoDir);
  const stream = await getDocker().buildImage(
    { context: repoDir, src },
    { t: tag, nocache: rebuild },
  );

  await new Promise<void>((resolve, reject) => {
    getDocker().modem.followProgress(
      stream,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
      (event: { stream?: string; error?: string }) => {
        if (event.error) {
          imageBuildState.error = event.error;
          process.stderr.write(`[image] ${event.error}\n`);
        }
        if (event.stream) {
          imageBuildState.lastLog = event.stream.trim();
          process.stdout.write(`[image] ${event.stream}`);
        }
      },
    );
  });

  imageBuildState.building = false;
  console.log(`[image] ${tag} ready.`);
}

/**
 * Idempotent: if the image already exists and rebuild is false, returns
 * immediately. If a build is already in flight, awaits it instead of starting
 * a second one.
 */
export async function ensureVmImage(rebuild = false): Promise<void> {
  if (!rebuild && (await imageExists(env.VM_IMAGE))) return;
  if (buildPromise) return buildPromise;
  buildPromise = build(rebuild).finally(() => {
    buildPromise = null;
  });
  return buildPromise;
}
