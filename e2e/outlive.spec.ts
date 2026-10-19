import { setTimeout as wait } from "node:timers/promises";
import { expect, type Page, type Route, test } from "@playwright/test";

const LONG_MESSAGE =
  "Plan the garage gym in order: clear the floor, fit the rubber mats, bolt the rack to the left " +
  "wall, hang the bar storage, add the bench, then the mirror, then the lights.";

/** Makes every API request fail the way a reverse proxy answers while the worker is down. */
const workerDown = (page: Page) =>
  page.route("**/api/**", (route) => route.fulfill({ status: 502, body: "Bad Gateway" }));
const workerBack = (page: Page) => page.unroute("**/api/**");

test("reloading mid-answer carries on with nothing missing or repeated", async ({ page }) => {
  await page.goto("/workspaces/garage-gym#new");
  await page.getByLabel("Message", { exact: true }).fill(LONG_MESSAGE);
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

// #390: the offline page's own check, started as it shows, can find the worker already back. It
// knows the worker was down, so that's the worker coming back, not one that answers oddly.
test("an offline page whose worker is back by its first check recovers at once", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();

  // The worker is down, but the health checks are held, unanswered, until it's back.
  const held: Route[] = [];
  await page.route("**/api/**", (route) =>
    route.request().url().endsWith("/api/health")
      ? held.push(route)
      : route.fulfill({ status: 502, body: "Bad Gateway" }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);

  await workerBack(page);
  // Some were the page's before the reload, gone with it.
  for (const route of held) await route.continue().catch(() => {});
  // Before the app-wide check would come round again (every 5 s).
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible({
    timeout: 4000,
  });
  await expect(page.getByText(/answered unexpectedly/)).toHaveCount(0);
});

test("a session page opened while the worker is down recovers with its whole session", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym#new");
  await page.getByLabel("Message", { exact: true }).fill("Survive the outage");
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Survive the outage");

  await workerDown(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();

  await workerBack(page);
  await expect(session).toContainText("You said: Survive the outage", { timeout: 10_000 });
});

/**
 * Marks the page if it ever says the worker can't be reached, however briefly: the banner, or a
 * page saying it's offline. From before the page loads, so a page load is watched too.
 */
const noteUnreachable = (page: Page) =>
  page.addInitScript(() => {
    new MutationObserver(() => {
      if (/can't reach|worker offline/i.test(document.body?.textContent ?? ""))
        document.documentElement.dataset.sawUnreachable = "yes";
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

/** Holds the next request to `url` for 3 s, then answers as a proxy that gave up on the worker. */
const slowOnce = (page: Page, url: string) =>
  page.route(
    url,
    async (route) => {
      await wait(3000);
      await route.fulfill({ status: 502, body: "Bad Gateway" });
    },
    { times: 1 },
  );

test("a page load the worker is slow to answer waits for it quietly, never saying it can't be reached (#228)", async ({
  page,
}) => {
  await noteUnreachable(page);
  await slowOnce(page, "**/api/**");

  await page.goto("/workspaces/garage-gym");

  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-saw-unreachable", "yes");
});

test("an open page whose health check the worker is slow to answer never says it can't be reached (#228)", async ({
  page,
}) => {
  await noteUnreachable(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  await slowOnce(page, "**/api/health");

  // The held check, then the one after it, answered.
  await page.waitForResponse((response) => response.url().endsWith("/api/health"));
  await page.waitForResponse(
    (response) => response.url().endsWith("/api/health") && response.status() === 200,
  );

  await expect(page.locator("html")).not.toHaveAttribute("data-saw-unreachable", "yes");
});

test("an open page with the device's network down says the worker can't be reached at once (#228)", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();
  let tries = 0;
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/api/health")) tries += 1;
  });

  await context.setOffline(true);

  const banner = page.getByRole("status").filter({ hasText: "Can't reach Courtyard's worker" });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  // After the first failed check: no retries first, as there would be for a slow worker.
  expect(tries).toBe(1);
  await context.setOffline(false);
  await expect(banner).toBeHidden({ timeout: 10_000 });
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
