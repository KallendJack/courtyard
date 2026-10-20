import { expect, type Locator, type Page, test } from "@playwright/test";

// A code workspace's title area (#333; Paper, "Code workspace Home" and "Tablet · Workspace ⋯:
// rename, icon, archive"), on start-worker.mjs's Side project, whose workspace.json has a line:
// its name with one quiet ⋯ beside it, then its connections line and its tabs. No line under the
// name, no caps line, and rename, the icon and archive are behind the ⋯. Nothing here changes
// Side project, which other tests use: each step is cancelled. Not Workbench: opened signed out,
// its Main row would be kept as having no build, which github-code-home.spec.ts checks.

const NAME = "Side project";

/** The Galaxy Z Fold 8 unfolded, in CSS pixels. */
const UNFOLDED = { width: 950, height: 712 };

const boxOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

/**
 * Where `sheet` sits against `anchor`, both measured at once: the page may still be laying out
 * (the side column comes in late on CI), so two measurements apart can be of two layouts.
 */
const against = async (anchor: Locator, sheet: Locator) => {
  const other = await sheet.elementHandle();
  return anchor.evaluate((element, other) => {
    const [a, b] = [element.getBoundingClientRect(), (other as Element).getBoundingClientRect()];
    return {
      below: b.top - a.bottom,
      left: b.left - a.left,
      right: b.right - a.right,
      foot: b.bottom,
    };
  }, other);
};

/** Checks the ⋯'s sheet is under it, its right edge level with the ⋯'s, so it never covers the name. */
const isUnder = async (page: Page) => {
  const more = page.getByRole("button", { name: "Workspace options" });
  const sheet = page.getByRole("dialog", { name: NAME });
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => Math.abs((await against(more, sheet)).right))
    .toBeLessThanOrEqual(2);
  expect((await against(more, sheet)).below).toBeGreaterThanOrEqual(0);
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
    "Allowed commandsWhat sessions run without asking",
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

  // Allowed commands (#185): what the owner allowed always, under the ⋯ where the menu was.
  await (await openMenu(page)).getByRole("button", { name: /^Allowed commands/ }).click();
  const allowed = page.getByRole("dialog", { name: `Allowed commands · ${NAME}` });
  await expect(allowed.getByRole("heading", { name: "Allowed commands" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(allowed).toBeHidden();

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
      await expect
        .poll(async () => Math.abs((await against(line, sheet)).left))
        .toBeLessThanOrEqual(2);
      const { below, foot } = await against(line, sheet);
      expect(below).toBeGreaterThanOrEqual(0);
      expect(foot).toBeLessThanOrEqual(420 - 16);
    });
  });
});
