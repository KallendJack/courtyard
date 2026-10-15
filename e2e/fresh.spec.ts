import { expect, type Page, test } from "@playwright/test";

// Every block stays fresh the same way (#387): asked again every 30 seconds while things are calm
// (faster while something is busy, as before), nothing while the tab is hidden, and at once when
// it's shown again, when the pages' own data (the workspaces) is asked for again too. Here the
// worker's answers change under the page, as they do when something happens on another device or
// on GitHub.

const NOW = Date.parse("2026-10-14T10:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

/** A build that has passed, as the worker gives it. */
const PASSED = {
  kind: "passed",
  startedAt: ago(180),
  completedAt: ago(0),
  stages: [
    [
      {
        name: "Checks",
        outcome: "passed",
        startedAt: ago(180),
        completedAt: ago(0),
        shards: null,
        needs: [],
      },
    ],
  ],
};

const HOME = "/workspaces/workbench";

/** Workbench's main, its newest commit `title()` ("1111111 Start") each time it's asked; how often it was. */
const mainAt = async (page: Page, title: () => string) => {
  const asked = { times: 0 };
  await page.route("**/api/workspaces/workbench/main", (route) => {
    asked.times += 1;
    const newest = title();
    return route.fulfill({
      json: {
        newest: { commit: newest.slice(0, 7).padEnd(40, "0"), title: newest },
        build: PASSED,
        liveCopy: false,
      },
    });
  });
  return asked;
};

/** Hides the tab, or shows it again, as switching to another app and back does. */
const setShown = (page: Page, shown: boolean) =>
  page.evaluate((visible) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !visible });
    document.dispatchEvent(new Event("visibilitychange"));
  }, shown);

test("a block asks again every 30 seconds while nothing is running", async ({ page }) => {
  await page.clock.install({ time: NOW });
  let newest = "1111111 Start";
  await mainAt(page, () => newest);
  await page.goto(HOME);
  const main = page.getByRole("region", { name: "Main" });
  await expect(main).toContainText("Start 1111111");

  newest = "2222222 Rail and Talk key";
  await page.clock.runFor(31_000);

  await expect(main).toContainText("Rail and Talk key 2222222");
});

test("hidden, a block asks nothing; shown again, it asks at once", async ({ page }) => {
  await page.clock.install({ time: NOW });
  let newest = "1111111 Start";
  const asked = await mainAt(page, () => newest);
  await page.goto(HOME);
  const main = page.getByRole("region", { name: "Main" });
  await expect(main).toContainText("Start 1111111");

  await setShown(page, false);
  const hiddenAt = asked.times;
  newest = "2222222 Rail and Talk key";
  await page.clock.runFor(95_000);
  expect(asked.times).toBe(hiddenAt);
  await expect(main).toContainText("Start 1111111");

  await setShown(page, true);

  await expect(main).toContainText("Rail and Talk key 2222222");
});

test("Home's New version shows a merge while nothing was running", async ({ page }) => {
  await page.clock.install({ time: NOW });
  let merged = false;
  let asked = 0;
  await page.route("**/api/live", (route) => {
    asked += 1;
    return route.fulfill({
      json: {
        kind: "live",
        running: { commit: "a".repeat(40), title: "a1b2c3d The running version" },
        newest: merged
          ? { commit: "7d518cd".padEnd(40, "0"), title: "7d518cd Rail and Talk key" }
          : { commit: "a".repeat(40), title: "a1b2c3d The running version" },
        newerOnMain: merged,
        lastUpdate: null,
        waiting: null,
        build: merged ? PASSED : null,
      },
    });
  });
  await page.goto("/");
  // Asked once, while main was where the live copy is: nothing to update to.
  await expect.poll(() => asked).toBeGreaterThan(0);
  const row = page.getByRole("region", { name: "New version" });
  await expect(row).toHaveCount(0);

  merged = true;
  await page.clock.runFor(31_000);

  await expect(row.getByRole("button", { name: "Update" })).toBeEnabled();
});

test("shown again, the workspaces are asked for again: one renamed elsewhere shows its new name", async ({
  page,
}) => {
  let renamed = false;
  await page.route("**/api/workspaces", async (route) => {
    const response = await route.fetch();
    const { workspaces } = (await response.json()) as { workspaces: { name: string }[] };
    await route.fulfill({
      response,
      json: {
        workspaces: workspaces.map((each) =>
          renamed && each.name === "Reading list" ? { ...each, name: "Books to read" } : each,
        ),
      },
    });
  });
  await page.goto("/workspaces/garage-gym");
  const workspaces = page.getByRole("navigation", { name: "Workspaces" });
  await expect(workspaces.getByRole("link", { name: "Reading list" })).toBeVisible();

  renamed = true;
  await setShown(page, false);
  await setShown(page, true);

  await expect(workspaces.getByRole("link", { name: "Books to read" })).toBeVisible();
});
