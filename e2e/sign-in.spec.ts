import { expect, test } from "@playwright/test";

// The fake acts signed out (COURTYARD_FAKE_SIGN_IN), with a pretend sign-in that finishes a few
// seconds after it starts, as signing in on another device would.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("the owner signs in from the home page, then out, then says Not now", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("region", { name: "Sign in to Fake" });
  const models = page.getByRole("region", { name: "Models" });

  await expect(box).toContainText("Fake isn't signed in. Sign in with your Fake plan");
  await expect(models).toContainText("Fake · not signed in");

  await box.getByRole("button", { name: "Sign in to Fake" }).click();
  await expect(box).toContainText("On any device, open courtyard.example/device");
  await expect(box).toContainText("FAKE-2026");
  await box.getByRole("button", { name: "Copy code" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("FAKE-2026");
  await expect(box.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);

  // The page carries on by itself once the sign-in finishes.
  await expect(models).toContainText("Fake · signed in as owner@courtyard.example, Pretend plan", {
    timeout: 15_000,
  });
  await expect(box).toBeHidden();

  await models.getByRole("button", { name: "Sign out" }).click();
  await expect(box).toContainText("Fake isn't signed in");
  await box.getByRole("button", { name: "Not now" }).click();
  await expect(box).toBeHidden();
  await expect(models.getByRole("button", { name: "Sign in" })).toBeVisible();

  // Not now is kept by the worker, not the page.
  await page.reload();
  await expect(models).toContainText("Fake · not signed in");
  await expect(box).toBeHidden();
});
