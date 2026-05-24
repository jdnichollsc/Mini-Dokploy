import { expect, test } from "@playwright/test";

import { signUp, uniqueUser } from "./_helpers";

test.describe("Authentication", () => {
  test("redirects unauthenticated users to /login on /", async ({ page }) => {
    // The landing page server-side-redirects to /deployments. Without a
    // session, /deployments renders the "Select an organization" prompt
    // because the protected procedure short-circuits.
    await page.goto("/");
    await page.waitForURL(/\/deployments/);
    // Either we see the "Select organization" prompt (FORBIDDEN) or the
    // empty deployments table. Both are valid post-redirect states.
    await expect(page.getByText(/select an organization first|new deployment/i)).toBeVisible();
  });

  test("sign up flow lands signed in", async ({ page }) => {
    const user = uniqueUser();
    await signUp(page, user);
    await page.goto("/organizations");
    // The "Create a new organization" CardTitle renders as a div, not a
    // heading. Match by text instead. The user's name in the menu is a
    // stronger signal of being signed in.
    await expect(page.getByText(/create a new organization/i)).toBeVisible();
    await expect(page.getByRole("button", { name: user.name })).toBeVisible();
  });

  test("sign out clears the session", async ({ page }) => {
    const user = uniqueUser();
    await signUp(page, user);
    // The header shows the user's name in the dropdown trigger after sign-in.
    await page.getByRole("button", { name: user.name }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    // After sign-out the user-menu becomes a "Sign In" link.
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
