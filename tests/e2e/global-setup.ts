import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Resets the smoke-test SQLite file before the suite runs so tests don't
// inherit stale users/orgs from a previous invocation.
//
// IMPORTANT: t3-env's `createEnv` captures `process.env` at import time,
// so DATABASE_URL MUST be set *before* the first import of any module that
// transitively imports `@mini-dokploy/env/db` — hence the dynamic import.
export default async function globalSetup() {
  if (process.env.E2E_FULL_STACK === "1") return;

  const dbPath = resolve(process.cwd(), ".e2e.db");
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      rmSync(dbPath + suffix, { force: true });
    } catch {
      // ignore
    }
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  process.env.DATABASE_URL = `file:${dbPath}`;

  const { runMigrations } = await import("@mini-dokploy/db/migrate");
  await runMigrations();
}
