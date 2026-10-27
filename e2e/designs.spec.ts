import { expect, type Locator, type Page, test } from "@playwright/test";
import { shot } from "./github.ts";
import { pageScrollsSideways } from "./page-scroll.ts";

// A code workspace's Designs tab (#522; Paper, "Tablet · Designs: Live boards, row by row" and
// "Tablet · Designs: one board full size"), on start-worker.mjs's Side project, whose Paper file
// the fake Paper has: Live and Agreed in sections, Drafts in a grid.

const DESIGNS = "/workspaces/side-project#designs";

/** The page picker's buttons. */
const picker = (page: Page) => page.getByRole("group", { name: "Pages" });

/** One page's boards, by the picker's name for it. */
const boardsOf = (page: Page, name: "Live" | "Agreed" | "Drafts") =>
  page.getByRole("region", { name: `${name} boards` });

/** Each row's name, top to bottom. */
const rowNames = (boards: Locator) => boards.getByRole("heading");

/** Opens the tab and waits for the boards Paper exported. */
const openDesigns = async (page: Page) => {
  await page.goto(DESIGNS);
  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(tabs.getByRole("link", { name: "Designs" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/^From Paper · /)).toBeVisible();
};

/** A picture's width over its height, as drawn. */
const shapeOf = async (picture: Locator) => {
  const box = await picture.boundingBox();
  return box === null ? 0 : box.width / box.height;
};

/** Live's rows, each named by its section, its boards Desktop, Tablet and Cover at their shapes. */
const showsLive = async (page: Page) => {
  await expect(picker(page).getByRole("button")).toHaveText(["Live8", "Agreed1", "Drafts3"]);
  await expect(picker(page).getByRole("button", { name: /^Live/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const live = boardsOf(page, "Live");
  await expect(rowNames(live)).toHaveText(["Style guide & brand", "Home", "Code workspace"]);
  const home = live.getByRole("region", { name: "Home" });
  await expect(home).toContainText("3 boards");
  await expect(home.getByRole("button")).toHaveText(["Desktop", "Tablet", "Cover"]);
  const picture = (device: string) =>
    home.getByRole("button", { name: `Open Built · ${device} · Home` }).locator("img");
  expect(await shapeOf(picture("Desktop"))).toBeCloseTo(1440 / 900, 1);
  expect(await shapeOf(picture("Tablet"))).toBeCloseTo(933 / 645, 1);
  expect(await shapeOf(picture("Cover"))).toBeCloseTo(476 / 695, 1);
};

test.describe("the Designs tab (#522)", () => {
  test.describe("on the unfolded Fold", () => {
    test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

    test("shows Live's boards row by row, then one full size, switching between its row's devices", async ({
      page,
    }) => {
      await openDesigns(page);
      await showsLive(page);
      await shot(page, "tablet-designs");

      await page.getByRole("button", { name: "Open Built · Tablet · Home" }).click();
      await expect(page.getByRole("heading", { name: "Home", level: 2 })).toBeVisible();
      await expect(page.getByText("Live · 933 × 645")).toBeVisible();
      const devices = page.getByRole("group", { name: "Devices" });
      await expect(devices.getByRole("button", { name: "Tablet" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("img", { name: "Built · Tablet · Home" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Open in Paper ›" })).toHaveAttribute(
        "href",
        "https://app.paper.design/file/file-1",
      );
      await expect(page.getByText(/^Pinch to zoom · From Paper · /)).toBeVisible();
      await shot(page, "tablet-designs-board");

      await devices.getByRole("button", { name: "Cover" }).click();
      await expect(page.getByText("Live · 476 × 695")).toBeVisible();
      await expect(page.getByRole("img", { name: "Built · Cover · Home" })).toBeVisible();

      await page.getByRole("button", { name: "Back to Live" }).click();
      await expect(boardsOf(page, "Live").getByRole("region", { name: "Home" })).toBeVisible();
    });

    test("shows Agreed's boards in their sections, and Drafts as their grid by topic", async ({
      page,
    }) => {
      await openDesigns(page);
      await picker(page)
        .getByRole("button", { name: /^Agreed/ })
        .click();
      const agreed = boardsOf(page, "Agreed");
      await expect(rowNames(agreed)).toHaveText(["Code workspace"]);
      await expect(agreed).toContainText("Tablet · Designs (#522)");

      await picker(page)
        .getByRole("button", { name: /^Drafts/ })
        .click();
      const drafts = boardsOf(page, "Drafts");
      await expect(rowNames(drafts)).toHaveText(["Audit", "Draft"]);
      await expect(drafts.getByRole("region", { name: "Audit" }).getByRole("button")).toHaveText([
        "Audit · Tablet · PRs",
        "Audit · Cover · PRs",
      ]);
    });

    test("a workspace with no Paper file offers to connect one", async ({ page }) => {
      await page.goto("/workspaces/toolshed#designs");
      await expect(
        page.getByText("Designs shows the boards in this workspace's Paper file."),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Connect Paper" })).toBeVisible();
    });
  });

  test.describe("on the cover screen", () => {
    test.use({ viewport: { width: 476, height: 695 }, hasTouch: true, isMobile: true });

    test("the rows fit the screen, each scrolling sideways on its own", async ({ page }) => {
      await openDesigns(page);
      await showsLive(page);
      expect(await pageScrollsSideways(page)).toBe(false);
      await shot(page, "cover-designs");
      await page.getByRole("button", { name: "Open Built · Tablet · Home" }).click();
      await expect(page.getByText("Live · 933 × 645")).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to Live" })).toBeInViewport();
      await expect(page.getByRole("heading", { name: "Home", level: 2 })).toBeInViewport();
      await expect(page.getByRole("link", { name: "Open in Paper ›" })).toBeInViewport();
      expect(await pageScrollsSideways(page)).toBe(false);
      await shot(page, "cover-designs-board");
    });
  });

  test.describe("on a desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("shows Live's rows beside the rail", async ({ page }) => {
      await openDesigns(page);
      await showsLive(page);
      await shot(page, "desktop-designs");
    });
  });
});
