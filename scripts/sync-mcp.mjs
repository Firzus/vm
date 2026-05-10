// Single-source the MCP servers config: copy `.mcp.json` (canonical, read by
// Claude Code at the repo root) over to `.cursor/mcp.json` (read by Cursor).
// Both files are committed; this script keeps them byte-identical so a single
// edit in `.mcp.json` is enough.
//
// Run after editing `.mcp.json`:
//
//     node scripts/sync-mcp.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, ".mcp.json");
const dst = resolve(root, ".cursor", "mcp.json");

const content = readFileSync(src, "utf8");
mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, content, "utf8");
console.log(`[sync-mcp] ${src} -> ${dst}`);
