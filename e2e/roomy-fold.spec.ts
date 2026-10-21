import { expect, type Locator, type Page, test } from "@playwright/test";

// Roomier screens on the Fold (#503; Paper, "Tablet · Code Home, roomier on the Fold" and its
// Planning Home and Code session boards): from a tablet up, the page sits straight on the frame,
// a workspace's tabs share its title's row, and Home's blocks get the room the board gives them.
// On start-worker.mjs's Workbench, signed in to the fake GitHub for its PRs tab and Next up.

test.beforeEach(async ({ request }) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
});

test.afterAll(async ({ request }) => {
  await request.post("/api/github/sign-out", { data: {} });
});

/** The Galaxy Z Fold 8 unfolded, in CSS pixels. */
const UNFOLDED = { width: 950, height: 712 };

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

const title = (page: Page) => page.getByRole("heading", { level: 1 });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Workspace tabs" });

/** Whether the tabs share the title's row: they start above the foot of what's under the name. */
const besideTheTitle = async (page: Page, under: Locator) =>
  (await boxOf(tabs(page))).y < (await boxOf(under)).y + (await boxOf(under)).height;

test.describe("on the unfolded Fold", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: UNFOLDED });

  test("a code workspace's Home: its tabs beside its title, and the board's room for its blocks", async ({
    page,
  }) => {
    await page.goto("/workspaces/workbench");
    await expect(title(page)).toHaveText("Workbench");
    // Its tabs, whichever it has: github-code-home.spec.ts may have merged its pull request.
    await expect(tabs(page).getByRole("link", { name: "Home" })).toBeVisible();
    // The title's row holds the name and the tabs, the connections line under the name.
    const line = page.getByRole("main").getByRole("button", { name: /octo-owner\/workbench/ });
    expect(await besideTheTitle(page, line)).toBe(true);
    // The title starts near the top: no raised panel, no deep gap above it.
    expect((await boxOf(title(page))).y).toBeLessThanOrEqual(32);
    // From the first block's top (the Builders board, #592) to Main's: the board gives the blocks
    // about 385 px.
    const first = page.getByRole("region", { name: "Builders" });
    const main = page.getByRole("region", { name: "Main" });
    await expect(main).toBeVisible();
    const [top, foot] = [await boxOf(first), await boxOf(main)];
    expect(foot.y - top.y).toBeGreaterThanOrEqual(370);
  });

  test("Next up is wider, and Grill sits beside its card's status line", async ({ page }) => {
    await page.goto("/workspaces/workbench");
    const next = page.getByRole("region", { name: "Next up" });
    const card = next.getByRole("region", { name: /^Grill #/ });
    const status = card.getByText("Needs grilling first", { exact: true });
    const grill = card.getByRole("button", { name: "Grill" });
    await expect(grill).toBeVisible();
    expect((await boxOf(next)).width).toBeGreaterThanOrEqual(285);
    // On the status line's row, not a full-width button under it.
    const [line, button] = [await boxOf(status), await boxOf(grill)];
    expect(button.x).toBeGreaterThan(line.x + line.width - 1);
    expect(button.y).toBeLessThan(line.y + line.height);
    expect(button.y + button.height).toBeGreaterThan(line.y);
  });

  test("a planning workspace's Home: its pills under its title, and rename, icon and archive behind ⋯", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await expect(title(page)).toHaveText("Garage gym");
    await expect(tabs(page)).toBeVisible();
    const more = page.getByRole("button", { name: "Workspace options" });
    await expect(more).toBeVisible();
    // The ⋯ shares the title's row; the pills sit under it, beside the photo (#481's Tablet board).
    const name = title(page);
    expect(await besideTheTitle(page, name)).toBe(false);
    expect((await boxOf(more)).y).toBeLessThan((await boxOf(name)).y + (await boxOf(name)).height);
    // No line above the name, and nothing of its own beside it but the ⋯.
    await expect(page.getByText("Workspace", { exact: true })).toHaveCount(0);
    for (const each of ["Change icon", "Rename workspace", "Archive workspace"]) {
      await expect(page.getByRole("button", { name: each })).toHaveCount(0);
    }
    await more.click();
    await expect(page.getByRole("dialog", { name: "Garage gym" }).getByRole("button")).toHaveText([
      "What Courtyard knowsFacts, ideas and skills",
      "Rename",
      "Change icon",
      "Notify meWhich notifications you get",
      "ArchiveHidden, never deleted",
    ]);
  });
});
