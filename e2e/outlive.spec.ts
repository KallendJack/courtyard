import { expect, type Page, test } from "@playwright/test";

const LONG_MESSAGE =
  "Plan the garage gym in order: clear the floor, fit the rubber mats, bolt the rack to the left " +
  "wall, hang the bar storage, add the bench, then the mirror, then the lights.";

/** Makes every API request fail the way a reverse proxy answers while the worker is down. */
const workerDown = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 502, body: "Bad Gateway" }));
const workerBack = (page: Page) => page.unroute("**/api/**");

test("reloading mid-answer carries on with nothing missing or repeated", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(LONG_MESSAGE);
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said:");
  await page.reload();

  await expect(session).toContainText(`You said: ${LONG_MESSAGE}`);
  await expect(session.getByText(/You said:/)).toHaveCount(1);
});

test("a page opened while the worker is down shows it as offline, and recovers by itself", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();

  await workerDown(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();

  await workerBack(page);
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible({
    timeout: 10_000,
  });
});

test("a session page opened while the worker is down recovers with its whole session", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill("Survive the outage");
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Survive the outage");

  await workerDown(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();

  await workerBack(page);
  await expect(session).toContainText("You said: Survive the outage", { timeout: 10_000 });
});

test("an open page notices the worker going away, and carries on when it's back", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();

  await workerDown(page);
  const banner = page.getByRole("status").filter({ hasText: "Can't reach Courtyard's worker" });
  await expect(banner).toBeVisible({ timeout: 10_000 });

  await workerBack(page);
  await expect(banner).toBeHidden({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
});
