import { expect, test } from "@playwright/test";

import { createAndActivateOrg, signUp, uniqueUser } from "./_helpers";

test("create + activate organization", async ({ page }) => {
  const user = uniqueUser();
  await signUp(page, user);
  await createAndActivateOrg(page, user.slug);

  // The org should appear in the list with an Active marker.
  await expect(page.getByText(new RegExp(user.slug.replace(/-/g, " "), "i"))).toBeVisible();
  await expect(page.getByText(/active/i)).toBeVisible();

  // Now /deployments should load (no longer "select org") with an empty state.
  await page.goto("/deployments");
  await expect(page.getByRole("heading", { name: /^deployments$/i })).toBeVisible();
  await expect(page.getByText(/no deployments yet/i)).toBeVisible();
});

test("/deployments shows org prompt before activation", async ({ page }) => {
  const user = uniqueUser();
  await signUp(page, user);
  // User is signed up but has no active organization yet.
  await page.goto("/deployments");
  await expect(page.getByText(/select.*create an organization first/i)).toBeVisible();
});
