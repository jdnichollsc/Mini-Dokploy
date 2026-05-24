import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Unique-per-test fixture for sign-up so tests can run in any order and the
// DB doesn't accumulate collisions across runs.
export function uniqueUser() {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    name: `Test ${stamp}`,
    email: `test+${stamp}@example.com`,
    password: "correcthorsebatterystaple",
    slug: `org-${stamp}`,
  };
}

export async function signUp(page: Page, user: { name: string; email: string; password: string }) {
  await page.goto("/login");

  // The login page defaults to the Sign In form. Toggle to Sign Up by clicking
  // the "Need an account? Sign Up" link button on that form.
  // Wait for the form to render past its `useSession()` loading state first.
  await expect(page.getByRole("button", { name: "Need an account? Sign Up" })).toBeVisible();
  await page.getByRole("button", { name: "Need an account? Sign Up" }).click();

  // Now the Sign Up form is shown.
  await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /^sign up$/i }).click();

  await page.waitForURL(/\/(organizations|deployments)/);
}

export async function createAndActivateOrg(page: Page, slug: string) {
  await page.goto("/organizations");
  await page.getByLabel("Name").fill(slug.replace(/-/g, " "));
  await page.getByLabel("Slug").fill(slug);
  await page.getByRole("button", { name: /create organization/i }).click();
  // After create the page auto-activates the new org and re-renders the
  // "Your organizations" list with an "Active" marker on the new row.
  await expect(page.getByText(/active/i)).toBeVisible();
}
