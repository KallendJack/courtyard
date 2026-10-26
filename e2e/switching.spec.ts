import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

// Switching workspaces (#808): one opened before shows its last data at once and updates in place,
// never waiting on the worker first; a tile starts loading its workspace as a finger lands on it.
// Each switch's time is split between the worker and the page, kept on the test as annotations.

test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

type Listed = { id: string; name: string };

const twoWorkspaces = async (request: APIRequestContext) => {
  const { workspaces } = (await (await request.get("/api/workspaces")).json()) as {
    workspaces: Listed[];
  };
  const [first, second] = workspaces;
  if (first === undefined || second === undefined) throw new Error("Two workspaces are seeded");
  return [first, second] as const;
};

const tileOf = (page: Page, workspace: Listed) =>
  page.getByRole("navigation", { name: "Workspaces" }).getByRole("link", { name: workspace.name });

const titleOf = (page: Page, workspace: Listed) =>
  page.getByRole("heading", { level: 1, name: workspace.name });

/** From now on, every answer from the worker takes 5 seconds: a slow worker, or a slow line. */
const slowWorker = (page: Page) =>
  page.route("**/api/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fallback();
  });

test("a workspace opened before shows at once, with no loading, while the worker is slow", async ({
  page,
  request,
}) => {
  const [first, second] = await twoWorkspaces(request);
  await page.goto(`/workspaces/${first.id}`);
  await expect(titleOf(page, first)).toBeVisible();
  await tileOf(page, second).click();
  await expect(titleOf(page, second)).toBeVisible();

  await slowWorker(page);
  await tileOf(page, first).click();

  await expect(titleOf(page, first)).toBeVisible({ timeout: 1000 });
  await expect(page.locator("[data-placeholder]")).toHaveCount(0);
});

test("a finger on a tile starts loading its workspace, so it opens at once", async ({
  page,
  request,
}) => {
  const [first, second] = await twoWorkspaces(request);
  await page.goto(`/workspaces/${first.id}`);
  await expect(titleOf(page, first)).toBeVisible();

  const loaded = page.waitForResponse(`**/api/workspaces/${second.id}`);
  await tileOf(page, second).dispatchEvent("touchstart");
  await loaded;
  await slowWorker(page);
  await tileOf(page, second).click();

  await expect(titleOf(page, second)).toBeVisible({ timeout: 1000 });
});

test("a move made while logged out elsewhere still ends at login", async ({ page, request }) => {
  const [first, second] = await twoWorkspaces(request);
  await page.goto(`/workspaces/${first.id}`);
  await expect(titleOf(page, first)).toBeVisible();

  // Logged out from another device: the move goes on at once, and asking behind it hears so.
  await page.route("**/api/auth", (route) => route.fulfill({ json: { state: "logged-out" } }));
  await tileOf(page, second).click();

  await expect(page).toHaveURL(/\/login$/);
});

/** How long a switch took, in milliseconds, and the worker's slowest answer in it. */
type Timing = { worker: number; drawn: number; asked: number; slowest: number };

/**
 * Taps a workspace's tile on the rail, as a finger does, and times it in the page itself: from the
 * tap to the worker's last answer the switch waited on, and to its title drawn.
 */
const timedSwitch = async (page: Page, workspace: Listed): Promise<Timing> =>
  page.evaluate(async (name) => {
    performance.clearResourceTimings();
    const tile = document.querySelector<HTMLElement>(
      `nav[aria-label="Workspaces"] a[aria-label="${name}"]`,
    );
    if (tile === null) throw new Error(`No tile for ${name}`);
    const start = performance.now();
    tile.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    tile.click();
    const drawn = await new Promise<number>((resolve) => {
      const look = () => {
        if (document.querySelector("h1")?.textContent?.includes(name)) resolve(performance.now());
        else requestAnimationFrame(look);
      };
      look();
    });
    const asked = performance
      .getEntriesByType("resource")
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => entry.name.includes("/api/") && entry.startTime >= start - 1)
      .filter((entry) => entry.responseEnd <= drawn);
    const answered = Math.max(start, ...asked.map((entry) => entry.responseEnd));
    return {
      worker: Math.round(answered - start),
      drawn: Math.round(drawn - start),
      asked: asked.length,
      slowest: Math.round(Math.max(0, ...asked.map((e) => e.responseStart - e.requestStart))),
    };
  }, workspace.name);

const note = (type: string, timing: Timing) =>
  test.info().annotations.push({
    type,
    description: `${timing.drawn} ms to drawn: ${timing.worker} ms on the worker (${timing.asked} asks, slowest ${timing.slowest} ms), ${timing.drawn - timing.worker} ms drawing`,
  });

test("switching workspaces, timed: a first open and a repeat open", async ({ page, request }) => {
  const [first, second] = await twoWorkspaces(request);
  await page.goto(`/workspaces/${first.id}`);
  await expect(titleOf(page, first)).toBeVisible();
  await expect(tileOf(page, second)).toBeVisible();

  note("first open", await timedSwitch(page, second));
  note("repeat open", await timedSwitch(page, first));
  note("repeat open", await timedSwitch(page, second));
});
