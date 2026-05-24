import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// E2E test setup.
// - Smoke tests run against `pnpm dev:web` with a temp SQLite file.
//   They cover auth + organizations + empty deployments list. No Docker/Swarm.
// - The @slow tag in the deploy flow requires `pnpm stack:up` to be running
//   externally (Temporal + worker + actual Docker builds). Run with
//   `E2E_FULL_STACK=1 pnpm test:e2e --grep @slow`.

const FULL_STACK = process.env.E2E_FULL_STACK === "1";
// Absolute path so the migrator (run from the repo root by globalSetup) and
// the dev server (which `cd`s into apps/web) target the *same* SQLite file.
const E2E_DB_PATH = resolve(process.cwd(), ".e2e.db");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: FULL_STACK ? 10 * 60 * 1000 : 60 * 1000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: FULL_STACK
      ? "http://dokploy.127.0.0.1.sslip.io"
      : "http://localhost:3001",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // When not targeting the full stack, boot the dev server in-process.
  ...(FULL_STACK
    ? {}
    : {
        webServer: {
          command: "pnpm -F web dev",
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: {
            // Absolute path: avoids working-directory drift between the
            // migrator (repo root) and the dev server (apps/web).
            DATABASE_URL: `file:${E2E_DB_PATH}`,
            BETTER_AUTH_SECRET:
              process.env.BETTER_AUTH_SECRET ?? "test_secret_minimum_32_chars_long_xxxxx",
            BETTER_AUTH_URL: "http://localhost:3001",
            CORS_ORIGIN: "http://localhost:3001",
          },
        },
      }),
});
