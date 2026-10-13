import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { themeColour } from "./theme.ts";

// Home, calm and touch-first (#102; Paper, "Home", desktop, tablet and cover screen): a tile per
// workspace with one line, and at its foot, only when needed, main's build with Update and one
// gold line for something wrong. The owner context, sign-ins and Connections are in Settings.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const FAKE = { provider: "fake", model: "echo" };

/** A planning workspace of its own, so its tile's line is this test's alone. */
const newWorkspace = async (request: APIRequestContext, name: string) => {
  const made = await request.post("/api/workspaces", { data: { name } });
  expect(made.status()).toBe(201);
  return ((await made.json()) as { id: string }).id;
};

/** Starts a session there and waits for its answer, which the owner hasn't seen: a new reply. */
const answered = async (request: APIRequestContext, id: string, text: string) => {
  const started = await request.post(`/api/workspaces/${id}/sessions`, {
    data: { text, model: FAKE },
  });
  expect(started.status()).toBe(201);
  await expect
    .poll(async () => {
      const list = await request.get(`/api/workspaces/${id}/sessions`);
      const { sessions } = (await list.json()) as { sessions: { waiting: string }[] };
      return sessions.map((session) => session.waiting);
    })
    .toEqual(["reply"]);
};

/** An open pull request on Workbench whose checks passed: ready to merge. */
const readyPull = (number: number) => ({
  pullRequest: {
    number,
    title: `Ready ${number}`,
    url: `https://github.com/octo-owner/workbench/pull/${number}`,
    state: "open",
    head: "a".repeat(40),
    checks: { kind: "passed" },
    changes: { additions: 1, deletions: 0, files: 1 },
    conflicts: false,
  },
  branch: `ready-${number}`,
  base: "main",
  from: { kind: "claude-code" },
  waiting: "merge",
});

/** Workbench's open pull requests, two ready to merge, whoever is signed in to GitHub. */
const twoReady = (page: Page) =>
  page.route("**/api/workspaces/workbench/pull-requests", (route) =>
    route.fulfill({ json: { pullRequests: [readyPull(401), readyPull(402)] } }),
  );

/** Main has moved on and its build passed: a new version is there. */
const newVersion = (page: Page) =>
  page.route("**/api/live", (route) =>
    route.fulfill({
      json: {
        kind: "live",
        running: { commit: "a".repeat(40), title: "a1b2c3d The running version" },
        newest: { commit: "8d57986".padEnd(40, "0"), title: "8d57986 Builds take turns" },
        newerOnMain: true,
        lastUpdate: null,
        build: {
          kind: "passed",
          // Courtyard's CI: three jobs side by side, the browser tests in two shards (#337).
          stages: [
            ["Checks", "Unit tests", "E2E"].map((name) => ({
              name,
              outcome: "passed",
              startedAt: "2026-10-13T09:57:00Z",
              completedAt: "2026-10-13T10:00:00Z",
              shards: name === "E2E" ? { done: 2, total: 2 } : null,
              needs: [],
            })),
          ],
          startedAt: "2026-10-13T09:57:00Z",
          completedAt: "2026-10-13T10:00:00Z",
        },
      },
    }),
  );

/** Nothing new on main and the backup up to date: no foot rows at all. */
const allWell = async (page: Page) => {
  await page.route("**/api/live", (route) => route.fulfill({ json: { kind: "off" } }));
  await page.route("**/api/backup", (route) => route.fulfill({ json: { kind: "up-to-date" } }));
};

/** The backup behind since a minute ago, which is today. */
const backupBehind = (page: Page) =>
  page.route("**/api/backup", (route) =>
    route.fulfill({
      json: {
        kind: "behind",
        since: new Date(Date.now() - 60_000).toISOString(),
        reason: "the remote can't be reached",
      },
    }),
  );

const tiles = (page: Page) => page.getByRole("main").getByRole("list", { name: "Workspaces" });
const tile = (page: Page, name: string | RegExp) => tiles(page).getByRole("link", { name });

/** Once every tile has its icon and its line, for a screenshot. */
const settled = (page: Page) =>
  expect
    .poll(() =>
      page
        .locator("main [data-line]")
        .evaluateAll(
          (lines) =>
            lines.length > 0 &&
            lines.every((line) => line.textContent !== "") &&
            document.querySelectorAll("main li svg").length > lines.length,
        ),
    )
    .toBe(true);

// The desktop boards' size.
test.use({ viewport: { width: 1440, height: 900 } });

test("Home is the workspaces, a tile each with its line, and nothing from Settings", async ({
  page,
  request,
}) => {
  const name = `Bench ${Date.now()}`;
  const id = await newWorkspace(request, name);
  await allWell(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
  await expect(tile(page, name)).toContainText("No sessions yet");
  await expect(tile(page, "New workspace")).toBeVisible();
  // None of what moved to Settings, and no foot rows while nothing needs them.
  await expect(page.getByRole("region", { name: "Owner context" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Connections" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Sign in to/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fresh start…" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "New version" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Updates" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Problem" })).toHaveCount(0);

  // An answer waiting for the owner: violet, by its session's name, with its count in the tile's
  // corner; the tap opens that session (#345).
  await answered(request, id, "Where does the bench go?");
  await page.reload();
  const line = tile(page, name).getByText(/^New reply · Where does the bench go/i);
  await expect(line).toBeVisible();
  expect(await line.evaluate((el) => getComputedStyle(el).color)).toBe(
    await themeColour(page, "primary-text"),
  );
  await expect(tile(page, name).locator("[aria-hidden]").filter({ hasText: /^1$/ })).toBeVisible();

  await tile(page, name).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${id}/sessions/`));
});

test("a code workspace's tile says what waits on the owner, in gold with a gold edge", async ({
  page,
}) => {
  await twoReady(page);
  await page.goto("/");

  const line = tile(page, /Workbench/).getByText(/2 PRs to merge/);
  await expect(line).toBeVisible();
  expect(await line.evaluate((el) => getComputedStyle(el).color)).toBe(
    await themeColour(page, "warning"),
  );
  await tile(page, /Workbench/).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workbench" })).toBeVisible();
});

test("Home doesn't jump: a tile's line keeps its place until it comes", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/workspaces/*/sessions", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/");
  const garage = tile(page, /Garage gym/);
  const name = garage.getByText("Garage gym", { exact: true });
  await expect(garage.locator("[data-placeholder]")).toBeVisible();
  const before = await name.boundingBox();
  const tileBefore = await garage.boundingBox();

  release();
  await expect(garage.locator("[data-placeholder]")).toHaveCount(0);
  expect(await name.boundingBox()).toEqual(before);
  expect(await garage.boundingBox()).toEqual(tileBefore);
});

test("the foot rows show only when needed: a new version with Update, and the worst problem with Fix it", async ({
  page,
}) => {
  await newVersion(page);
  await backupBehind(page);
  await page.goto("/");

  const version = page.getByRole("region", { name: "New version" });
  await expect(version).toContainText("Builds take turns 8d57986");
  await expect(version.getByRole("status")).toHaveText("Passed · 3:00");
  await expect(version.getByRole("button", { name: "Update" })).toBeEnabled();
  const problem = page.getByRole("region", { name: "Problem" });
  await expect(problem).toContainText(/^Backup behind since \d\d:\d\d/);
  await settled(page);
  await shot(page, "desktop-home-foot-rows");

  await problem.getByRole("link", { name: "Fix it" }).click();
  await expect(page).toHaveURL(/\/settings#backup$/);
  await expect(page.getByRole("region", { name: "Backup" })).toContainText(
    "the remote can't be reached",
  );
});

test("Settings has the owner context, the sign-ins and Connections, Fresh start and logging out the rest", async ({
  page,
}) => {
  await allWell(page);
  await page.goto("/");
  await settled(page);
  await shot(page, "desktop-home");

  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Owner context" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Connections" })
      .getByRole("listitem", { name: "Fake", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Fresh start…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out all other devices" })).toBeVisible();
});

// Owner rule (2026-10-12): nothing jumps in. Settings' Connections keeps its place with faint rows
// until where each sign-in stands is known.
test("Settings' Connections keeps its place until it's known", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sign-ins", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/settings");
  const connections = page.getByRole("region", { name: "Connections" });
  await expect(connections.locator("[data-placeholder]")).toBeVisible();
  release();
  await expect(connections.getByRole("listitem", { name: "Fake", exact: true })).toBeVisible();
  await expect(connections.locator("[data-placeholder]")).toHaveCount(0);
});

test.describe("on a tablet", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("three tiles a row, a tap opens the workspace, and Settings is in the frame's Settings", async ({
    page,
  }) => {
    await allWell(page);
    await page.goto("/");
    const all = tiles(page).getByRole("link");
    await expect(all.first()).toBeVisible();
    await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
    const tops = await all.evaluateAll((links) =>
      links.slice(0, 4).map((link) => Math.round(link.getBoundingClientRect().top)),
    );
    expect(tops.slice(0, 3).every((top) => top === tops[0])).toBe(true);
    expect(tops[3]).toBeGreaterThan(tops[0] ?? 0);
    await settled(page);
    await shot(page, "tablet-home");

    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("link", { name: "All settings" })
      .click();
    await expect(page.getByRole("region", { name: "Owner context" })).toBeVisible();

    await page.getByRole("link", { name: "Home", exact: true }).click();
    await tile(page, /Garage gym/).click();
    await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
  });

  test("the foot rows sit at the foot, in thumb reach", async ({ page }) => {
    await newVersion(page);
    await backupBehind(page);
    await twoReady(page);
    await page.goto("/");
    const problem = page.getByRole("region", { name: "Problem" });
    await expect(problem).toBeVisible();
    await expect(page.getByRole("region", { name: "New version" })).toBeVisible();
    await expect(tile(page, /Workbench/)).toContainText("2 PRs to merge");
    const box = await problem.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(712 - 60);
    await settled(page);
    await shot(page, "tablet-home-foot-rows");
  });
});

test.describe("on the cover screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 640 } });

  test("two tiles a row, in short words, with the foot rows under them", async ({ page }) => {
    await allWell(page);
    await page.goto("/");
    const all = tiles(page).getByRole("link");
    await expect(all.first()).toBeVisible();
    const tops = await all.evaluateAll((links) =>
      links.slice(0, 3).map((link) => Math.round(link.getBoundingClientRect().top)),
    );
    expect(tops[1]).toBe(tops[0]);
    expect(tops[2]).toBeGreaterThan(tops[0] ?? 0);
    await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
    await settled(page);
    await shot(page, "cover-home");
  });

  test("the new version reads as the cover screen's board has it", async ({ page }) => {
    await newVersion(page);
    await backupBehind(page);
    await twoReady(page);
    await page.goto("/");
    const version = page.getByRole("region", { name: "New version" });
    await expect(version).toContainText("New version · 8d57986", { useInnerText: true });
    await expect(version.getByRole("button", { name: "Update" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Problem" })).toBeVisible();
    await expect(tile(page, /Workbench/)).toContainText("2 to merge");
    await page.getByRole("region", { name: "Problem" }).scrollIntoViewIfNeeded();
    await settled(page);
    await shot(page, "cover-home-foot-rows");
  });
});

// One screen from a tablet up (owner, 2026-10-12; #339): the title stays in view and the foot rows
// stay at the foot, and only the tiles scroll when there are more than fit. These come last, as
// the workspaces they add would crowd the screenshots above.

/** More workspaces than fit on one screen. */
const manyWorkspaces = async (request: APIRequestContext) => {
  for (const n of [1, 2, 3, 4, 5, 6]) await newWorkspace(request, `Shed ${n} ${Date.now()}`);
};

/** The title, the tiles' area and the foot rows all on one screen, and only the tiles scroll. */
const keepsOneScreen = async (page: Page, height: number) => {
  await newVersion(page);
  await backupBehind(page);
  await page.goto("/");
  const title = page.getByRole("heading", { level: 1, name: "Workspaces" });
  const problem = page.getByRole("region", { name: "Problem" });
  await expect(problem).toBeVisible();
  await expect(page.getByRole("region", { name: "New version" })).toBeVisible();
  await settled(page);

  const area = tiles(page).locator("..");
  const scrolls = await area.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  const panel = page.locator('[data-scroll-restoration-id="page"]');
  expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);

  const titleBefore = await title.boundingBox();
  const footBefore = await problem.boundingBox();
  expect((footBefore?.y ?? height) + (footBefore?.height ?? 0)).toBeLessThanOrEqual(height);
  await area.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(tiles(page).getByRole("link", { name: "New workspace" })).toBeInViewport();
  expect(await title.boundingBox()).toEqual(titleBefore);
  expect(await problem.boundingBox()).toEqual(footBefore);
};

test.describe("with more workspaces than fit", () => {
  test("on a desktop the title and foot rows stay in view, and only the tiles scroll", async ({
    page,
    request,
  }) => {
    await manyWorkspaces(request);
    await keepsOneScreen(page, 900);
    await shot(page, "desktop-home-many");
  });

  test.describe("on a tablet", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

    test("the title and foot rows stay in view, and only the tiles scroll", async ({
      page,
      request,
    }) => {
      await manyWorkspaces(request);
      await keepsOneScreen(page, 712);
      await shot(page, "tablet-home-many");
    });
  });
});
