import { join } from "node:path";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";

// Arrange workspaces (#321; Paper, "Tablet · Arrange workspaces"): hold a workspace on the rail
// (tablet) or the sidebar (desktop) and drag it up or down; letting go saves the order, and every
// list of workspaces follows it, Home's tiles too. Home's tiles are never dragged themselves.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

type Listed = { id: string; name: string; mode: "planning" | "code" };

const listed = async (request: APIRequestContext) => {
  const response = await request.get("/api/workspaces");
  return ((await response.json()) as { workspaces: Listed[] }).workspaces;
};

const byName = (a: Listed, b: Listed) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Puts the workspaces back in name order, as they were before any test arranged them, since the
 * other tests share this worker.
 */
const byNameAgain = async (request: APIRequestContext) => {
  const every = await listed(request);
  const order = [
    ...every.filter((each) => each.mode === "planning").sort(byName),
    ...every.filter((each) => each.mode === "code").sort(byName),
  ].map((each) => each.id);
  const put = await request.put("/api/workspaces/order", { data: { order } });
  expect(put.status()).toBe(200);
};

const middleOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** The names in a list of workspace links, in order. */
const namesIn = (links: Locator) => links.evaluateAll((all) => all.map((a) => a.ariaLabel ?? ""));

/** Whether `first` comes before `second` in a list of workspace links. */
const before = async (links: Locator, first: string, second: string) => {
  const names = await namesIn(links);
  return names.indexOf(first) !== -1 && names.indexOf(first) < names.indexOf(second);
};

test.afterEach(async ({ request }) => {
  await byNameAgain(request);
});

test.describe("on a tablet's rail", () => {
  /** The Galaxy Z Fold 8 unfolded, a touch screen. */
  test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

  test("a workspace held and dragged up moves there, Home follows, and it stays", async ({
    page,
  }) => {
    await page.goto("/");
    const rail = page.getByRole("list", { name: "Planning workspaces" });
    const tiles = rail.getByRole("link").and(page.locator("[data-arrange]"));
    await expect(rail.getByRole("link", { name: "Reading list" })).toBeVisible();
    expect(await before(tiles, "Garage gym", "Reading list")).toBe(true);

    // A finger holds Reading list still, then drags it up onto Garage gym's place.
    const from = await middleOf(rail.getByRole("link", { name: "Reading list" }));
    const to = await middleOf(rail.getByRole("link", { name: "Garage gym" }));
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    await page.waitForTimeout(600);
    for (let step = 1; step <= 8; step += 1) {
      const y = from.y + ((to.y - from.y) * step) / 8;
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: from.x, y }],
      });
      if (step === 5) {
        // Lifted: nothing else on the page changes; a slot shows where it'll land.
        await expect(
          page.locator("[aria-hidden].fixed", { hasText: "Reading list" }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
        await shot(page, "arrange-rail-mid-drag");
      }
    }
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/api/workspaces/order"),
    );
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect((await saved).status()).toBe(200);

    await expect.poll(() => before(tiles, "Reading list", "Garage gym")).toBe(true);
    // Still Home: letting go isn't a tap on the workspace.
    await expect(page).toHaveURL(/\/$/);
    const home = tilesOnHome(page);
    await expect.poll(() => namesOnHome(home, "Reading list", "Garage gym")).toBe(true);
    await shot(page, "arrange-home-after");

    await page.reload();
    await expect(rail.getByRole("link", { name: "Reading list" })).toBeVisible();
    expect(await before(tiles, "Reading list", "Garage gym")).toBe(true);
    expect(await namesOnHome(home, "Reading list", "Garage gym")).toBe(true);
  });

  test("the open workspace held and let go where it was still shows its recent sessions", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const tile = page
      .getByRole("list", { name: "Planning workspaces" })
      .getByRole("link", { name: "Garage gym" });
    await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();

    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [await middleOf(tile)],
    });
    await page.waitForTimeout(600);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(page.getByRole("dialog", { name: "Garage gym" })).toBeVisible();
    await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
  });

  test("Home's tiles can't be dragged: holding one and moving changes nothing", async ({
    page,
  }) => {
    await page.goto("/");
    const home = tilesOnHome(page);
    await expect(tileOnHome(home, "Reading list")).toBeVisible();
    await expect(page.getByRole("main").locator("[data-arrange]")).toHaveCount(0);

    const from = await middleOf(tileOnHome(home, "Reading list"));
    const to = await middleOf(tileOnHome(home, "Garage gym"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    expect(await namesOnHome(home, "Garage gym", "Reading list")).toBe(true);
  });
});

/**
 * Home's tiles. The list's name is matched exactly: "Workspaces" is also part of the rail's
 * "Planning workspaces" (#351).
 */
const tilesOnHome = (page: Page) =>
  page.getByRole("main").getByRole("list", { name: "Workspaces", exact: true }).getByRole("link");

/** The tile on Home named `name`, not one whose line below only mentions it (#351). */
const tileOnHome = (tiles: Locator, name: string) =>
  tiles.filter({ has: tiles.page().getByText(name, { exact: true }) });

/** Whether `first` comes before `second` among Home's tiles, which are named by their text. */
const namesOnHome = async (tiles: Locator, first: string, second: string) => {
  const names = await tiles.evaluateAll((all) => all.map((a) => a.textContent ?? ""));
  const at = (name: string) => names.findIndex((text) => text.startsWith(name));
  return at(first) !== -1 && at(first) < at(second);
};

test.describe("in a desktop's sidebar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a workspace pressed, held and dragged up moves there, and stays", async ({ page }) => {
    await page.goto("/workspaces/office");
    const sidebar = page.getByRole("list", { name: "Planning workspaces" });
    const rows = sidebar.getByRole("link").and(page.locator("[data-arrange]"));
    await expect(sidebar.getByRole("link", { name: "Reading list" })).toBeVisible();

    const from = await middleOf(sidebar.getByRole("link", { name: "Reading list" }));
    const to = await middleOf(sidebar.getByRole("link", { name: "Garage gym" }));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 4 });
    await expect(page.locator("[aria-hidden].fixed", { hasText: "Reading list" })).toBeVisible();
    await shot(page, "arrange-sidebar-mid-drag");
    await page.mouse.move(to.x, to.y, { steps: 4 });
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/api/workspaces/order"),
    );
    await page.mouse.up();
    expect((await saved).status()).toBe(200);

    await expect.poll(() => before(rows, "Reading list", "Garage gym")).toBe(true);
    // Letting go isn't a click on the workspace: the page stays.
    await expect(page.getByRole("heading", { level: 1, name: "office" })).toBeVisible();

    await page.reload();
    await expect(sidebar.getByRole("link", { name: "Reading list" })).toBeVisible();
    expect(await before(rows, "Reading list", "Garage gym")).toBe(true);
  });

  test("Alt+↑ moves the focused workspace up a place, for the keyboard", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("list", { name: "Planning workspaces" });
    const rows = sidebar.getByRole("link").and(page.locator("[data-arrange]"));
    const reading = sidebar.getByRole("link", { name: "Reading list" });
    await expect(reading).toBeVisible();
    const names = await namesIn(rows);
    const above = names[names.indexOf("Reading list") - 1] ?? "";

    await reading.focus();
    await page.keyboard.press("Alt+ArrowUp");

    await expect.poll(() => before(rows, "Reading list", above)).toBe(true);
    await expect(reading).toBeFocused();
  });

  test("a planning workspace dragged among the code ones stays at the end of its own group", async ({
    page,
  }) => {
    await page.goto("/");
    const planning = page.getByRole("list", { name: "Planning workspaces" });
    const code = page.getByRole("list", { name: "Code workspaces" });
    await expect(code.getByRole("link", { name: "Workbench" })).toBeVisible();

    const from = await middleOf(planning.getByRole("link", { name: "Garage gym" }));
    const to = await middleOf(code.getByRole("link", { name: "Workbench" }));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/api/workspaces/order"),
    );
    await page.mouse.up();
    expect((await saved).status()).toBe(200);

    const rows = planning.getByRole("link").and(page.locator("[data-arrange]"));
    await expect.poll(async () => (await namesIn(rows)).at(-1)).toBe("Garage gym");
    await expect(code.getByRole("link", { name: "Garage gym" })).toHaveCount(0);
  });
});
