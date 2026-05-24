import { expect, test } from "@playwright/test";

import { createAndActivateOrg, signUp, uniqueUser } from "./_helpers";

// Full-stack tests: require Docker Swarm + Temporal + the dokploy stack to be
// running externally (pnpm stack:up). Marked `@slow` so they're excluded
// from the default `pnpm test:e2e` run.
//
// Run with: E2E_FULL_STACK=1 pnpm test:e2e --grep @slow

test.describe("Deploy lifecycle @slow", () => {
  test.skip(process.env.E2E_FULL_STACK !== "1", "Requires pnpm stack:up");

  test("create deployment → reaches running → reachable URL", async ({ page, request }) => {
    const user = uniqueUser();
    await signUp(page, user);
    await createAndActivateOrg(page, user.slug);

    // A minimal, well-known Dockerfile-equipped repo.
    await page.goto("/deployments/new");
    await page.getByLabel("Name").fill("smoke-test-app");
    await page.getByLabel("Git repository URL").fill("https://github.com/dokku/smoke-test-app");
    await page.getByLabel("Exposed port").fill("5000");
    await page.getByRole("button", { name: /^deploy$/i }).click();

    // The detail page polls every 3s; status moves pending → building →
    // deploying → running. Allow up to 8 minutes for a cold build.
    await expect(page.getByText(/running/i)).toBeVisible({ timeout: 8 * 60 * 1000 });

    const url = await page.getByRole("link", { name: /127\.0\.0\.1\.sslip\.io/i }).getAttribute("href");
    expect(url).toBeTruthy();

    // Hit the deployment URL — should return a non-5xx.
    const res = await request.get(url!);
    expect(res.status()).toBeLessThan(500);
  });
});
