import { expect, test } from "@playwright/test";

const LONG_MESSAGE =
  "Plan the garage gym in order: clear the floor, fit the rubber mats, bolt the rack to the left " +
  "wall, hang the bar storage, add the bench, then the mirror, then the lights.";

test("reloading mid-answer carries on with nothing missing or repeated", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(LONG_MESSAGE);
  await page.getByRole("button", { name: "Send" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said:");
  await page.reload();

  await expect(session).toContainText(`You said: ${LONG_MESSAGE}`);
  await expect(session.getByText(/You said:/)).toHaveCount(1);
});

test("an unreachable worker shows as offline, and the page recovers by itself", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();

  await page.route("**/api/**", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();

  await page.unroute("**/api/**");
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible({
    timeout: 10_000,
  });
});
