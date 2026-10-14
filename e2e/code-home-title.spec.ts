import { expect, type Page, test } from "@playwright/test";

// A code workspace's title area (#333; Paper, "Code workspace Home" and "Tablet · Workspace ⋯:
// rename, icon, archive"), on start-worker.mjs's Side project, whose workspace.json has a line:
// its name with one quiet ⋯ beside it, then its connections line and its tabs. No line under the
// name, no caps line, and rename, the icon and archive are behind the ⋯. Nothing here changes
// Side project, which other tests use: each step is cancelled. Not Workbench: opened signed out,
// its Main row would be kept as having no build, which github.spec.ts's Home checks.

const NAME = "Side project";

/** The Galaxy Z Fold 8 unfolded, in CSS pixels. */
const UNFOLDED = { width: 950, height: 712 };

const boxOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

/** Checks the ⋯'s sheet is under it, its right edge level with the ⋯'s, so it never covers the name. */
const isUnder = async (page: Page) => {
  const more = page.getByRole("button", { name: "Workspace options" });
  const sheet = page.getByRole("dialog", { name: NAME });
  await expect(sheet).toBeVisible();
  const [button, box] = [await boxOf(more), await boxOf(sheet)];
  expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(Math.abs(box.x + box.width - (button.x + button.width))).toBeLessThanOrEqual(2);
  return sheet;
};

/** Opens the ⋯, checks its sheet opens under it, and gives the sheet. */
const openMenu = async (page: Page) => {
  await page.getByRole("button", { name: "Workspace options" }).click();
  return isUnder(page);
};

const titleAsTheBoards = async (page: Page) => {
  await page.goto("/workspaces/side-project");
  const title = page.getByRole("heading", { level: 1, name: NAME });
  await expect(title).toBeVisible();
  // Once Home is there, the connections line comes straight after the name.
  const line = page.getByRole("button", { name: /octo-owner\/side-project/ });
  await expect(line).toBeVisible();
  // No line under the name: it stays in workspace.json for the home chat and turns.
  await expect(page.getByText("Somewhere to try things out")).toHaveCount(0);
  // No caps line, and no icon, rename or archive of their own beside the name.
  await expect(page.getByText("Code workspace", { exact: true })).toHaveCount(0);
  for (const name of ["Change icon", "Rename workspace", "Archive workspace"]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  const [name, under] = [await boxOf(title), await boxOf(line)];
  expect(under.y - (name.y + name.height)).toBeLessThan(16);

  const sheet = await openMenu(page);
  await expect(sheet.getByRole("button")).toHaveText([
    "Rename",
    "Change icon",
    "ArchiveHidden, never deleted",
  ]);

  // Rename: the name's own field, in its place; Cancel puts the name back.
  await sheet.getByRole("button", { name: "Rename" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByLabel("Workspace name")).toHaveValue(NAME);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(title).toBeVisible();

  // Change icon: the Icon sheet.
  await (await openMenu(page)).getByRole("button", { name: "Change icon" }).click();
  const icons = page.getByRole("dialog", { name: "Icon" });
  await expect(icons.getByRole("radiogroup", { name: "Icon" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(icons).toBeHidden();

  // Archive: the confirm step, as before.
  await (await openMenu(page)).getByRole("button", { name: /^Archive/ }).click();
  const confirm = page.getByRole("region", { name: `Archive ${NAME}?` });
  await expect(confirm.getByRole("button", { name: "Archive workspace" })).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
};

test.describe("a code workspace's title area (#333)", () => {
  test("on a desktop, the name, its connections line and a quiet ⋯ for rename, icon and archive", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await titleAsTheBoards(page);
  });

  test.describe("on the unfolded Fold", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: UNFOLDED });

    test("the same, with the ⋯'s sheet under it", async ({ page }) => {
      await titleAsTheBoards(page);
    });

    // Placed once when it opened, it was left 150 px out when the side column came in after (#397).
    test("the sheet stays under the ⋯ when the page lays out again", async ({ page }) => {
      await page.goto("/workspaces/side-project");
      await openMenu(page);
      await page.setViewportSize({ width: UNFOLDED.width - 120, height: UNFOLDED.height });
      await isUnder(page);
    });

    test("the Connections sheet opens under its line with its foot on a short screen", async ({
      page,
    }) => {
      await page.setViewportSize({ width: UNFOLDED.width, height: 420 });
      await page.goto("/workspaces/side-project");
      const line = page.getByRole("button", { name: /octo-owner\/side-project/ });
      await line.click();
      const sheet = page.getByRole("dialog", { name: "Connections" });
      await expect(sheet).toBeVisible();
      const [under, box] = [await boxOf(line), await boxOf(sheet)];
      expect(box.y).toBeGreaterThanOrEqual(under.y + under.height);
      expect(Math.abs(box.x - under.x)).toBeLessThanOrEqual(2);
      expect(box.y + box.height).toBeLessThanOrEqual(420 - 16);
    });
  });
});
