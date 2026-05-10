// Render `.mcp.template.json` into the two MCP server config files Claude
// Code and Cursor expect at well-known locations:
//
//   .mcp.json          (read by Claude Code at the repo root)
//   .cursor/mcp.json   (read by Cursor)
//
// The template carries portable placeholders so the committed source has no
// machine-specific paths. The generated files are user-local and gitignored.
//
// Placeholders resolved by this script:
//   ${REPO_ROOT}  absolute path to the repo root, slash-normalised.
//   ${PYTHON}     absolute path to the mcp-server venv interpreter; chosen
//                 per-platform (Windows: .venv/Scripts/python.exe, POSIX:
//                 .venv/bin/python).
//
// Run after cloning the repo or editing `.mcp.template.json`:
//
//     node scripts/sync-mcp.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const repoRoot = root.replace(/\\/g, "/");
const isWindows = platform() === "win32";
const python = isWindows
  ? `${repoRoot}/apps/mcp-server/.venv/Scripts/python.exe`
  : `${repoRoot}/apps/mcp-server/.venv/bin/python`;

const tpl = readFileSync(resolve(root, ".mcp.template.json"), "utf8");
const rendered = tpl
  .replaceAll("${REPO_ROOT}", repoRoot)
  .replaceAll("${PYTHON}", python);

const targets = [
  resolve(root, ".mcp.json"),
  resolve(root, ".cursor", "mcp.json"),
];

for (const dst of targets) {
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, rendered, "utf8");
  console.log(`[sync-mcp] wrote ${dst}`);
}
