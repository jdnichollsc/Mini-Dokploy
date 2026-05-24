import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { config } from "dotenv";

// Walk up from CWD looking for the first .env we can find, then load it.
// Also anchor relative paths (DATABASE_URL, DOKPLOY_LOG_DIR, DOKPLOY_BUILD_DIR)
// to the directory containing .env so every process (web, worker, migrator)
// points at the same files regardless of where it was launched from.

function findRootEnv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function anchorPath(envDir: string, value: string | undefined): string | undefined {
  if (!value) return value;
  if (isAbsolute(value)) return value;
  if (!value.startsWith(".")) return value;
  return resolve(envDir, value);
}

const found = findRootEnv();
if (found) {
  // override:true so the repo-root .env wins over Next.js's auto-loaded
  // apps/web/.env (if one ever exists again) or any other intermediate file.
  config({ path: found, override: true });
  const envDir = dirname(found);

  // file:./local.db → file:/abs/path/local.db
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const match = dbUrl.match(/^file:(\.{1,2}\/[^?]+)(\?.*)?$/);
    if (match) {
      const [, relPath, suffix = ""] = match;
      process.env.DATABASE_URL = `file:${resolve(envDir, relPath)}${suffix}`;
    }
  }

  // ./relative → /abs paths so workers and web write to the same place.
  for (const key of ["DOKPLOY_LOG_DIR", "DOKPLOY_BUILD_DIR"] as const) {
    process.env[key] = anchorPath(envDir, process.env[key]);
  }
}
