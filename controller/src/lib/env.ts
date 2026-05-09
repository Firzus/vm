/**
 * Validated environment, parsed once at module load. Importing this throws
 * immediately if VM_* env vars are malformed, so failures surface during boot
 * instead of at the first VM creation.
 *
 * SERVER ONLY — never import from a client component.
 */
import path from "node:path";
import { EnvSchema, type Env } from "./schemas";

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid VM_* environment variables:\n${issues}\n` +
        "Fix .env.local or your shell environment, then restart the controller.",
    );
  }
  // Default the repo dir to the parent of the controller package, where the
  // VM Dockerfile lives.
  const env = result.data;
  if (!env.VM_REPO_DIR) {
    env.VM_REPO_DIR = path.resolve(process.cwd(), "..");
  }
  return env;
}

export const env: Env = loadEnv();
