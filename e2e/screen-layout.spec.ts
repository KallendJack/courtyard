import { expect, type Locator, type Page, test } from "@playwright/test";
import { READING_SESSION_ID } from "./long-session.ts";
import { newWorkspace, startSaving } from "./saving.ts";
import { openWhatCourtyardKnows } from "./workspace-page.ts";

// Every screen is a pinned header, one scrolling middle and a pinned footer (#339): from a tablet
// up, a screen's title and its main action stay in view however long what's between them is.
// Each screen's middle is made far longer than the screen, whatever it holds, and scrolled to its
// end.

/** The one box that scrolls the screen: its middle. */
const middle = (page: Page) => page.locator('[data-scroll-restoration-id="page"]');

/** Puts something far taller than the screen at the end of `box`. */
const lengthen = (box: Locator) =>
  box.evaluate((element) => {
    const filler = document.createElement("div");
    filler.style.height = "3000px";
    filler.style.flexShrink = "0";
    (element.firstElementChild ?? element).append(filler);
  });

/** Scrolls `box` to its end, and waits until it's there. */
const scrollToEnd = async (box: Locator) => {
  await box.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => box.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000);
};

/** Whether each of `pinned` is in view and stays where it is while `scroll` runs. */
const staysPut = async (pinned: readonly Locator[], scroll: () => Promise<void>) => {
  for (const each of pinned) await expect(each).toBeInViewport({ ratio: 1 });
  const before = await Promise.all(pinned.map((each) => each.boundingBox()));
  await scroll();
  for (const [index, each] of pinned.entries()) {
    await expect(each).toBeInViewport({ ratio: 1 });
    expect(await each.boundingBox()).toEqual(before[index]);
  }
};

/**
 * How far above the panel's bottom edge the page's lowest drawn thing (a card, a row, a line of
 * text) ends: nothing runs into the edge, whether the message box is in the page or docked in the
 * frame below it.
 */
const footGap = (page: Page) =>
  page.locator("main").evaluate((main) => {
    // The panel the page sits on: the nearest box around `main` with a size of its own.
    let around = main.parentElement;
    while (around && around.getBoundingClientRect().height === 0) around = around.parentElement;
    const panel = (around ?? main).getBoundingClientRect();
    // Measured at the middle's end, as the owner sees it once scrolled down.
    const middle = main.querySelector('[data-scroll-restoration-id="page"]');
    middle?.scrollTo({ top: middle.scrollHeight });
    const scroller = main
      .querySelector('[data-scroll-restoration-id="page"]')
      ?.getBoundingClientRect();
    let lowest = 0;
    for (const each of main.querySelectorAll("*")) {
      const style = getComputedStyle(each);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const box = each.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const painted =
        style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
        style.borderBottomWidth !== "0px" ||
        [...each.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim());
      if (!painted) continue;
      // What the middle has scrolled out of sight isn't drawn.
      const bottom =
        scroller && each.closest('[data-scroll-restoration-id="page"]')
          ? Math.min(box.bottom, scroller.bottom)
          : box.bottom;
      lowest = Math.max(lowest, bottom);
    }
    return Math.round(panel.bottom - lowest);
  });

/**
 * With a middle longer than the screen: only the middle scrolls (not the window, nor the panel
 * around the page), and what's pinned stays where it was, in view. Before that, as it is, the
 * page keeps a gap at its foot.
 */
const keepsPinned = async (page: Page, pinned: readonly Locator[]) => {
  await expect(middle(page)).toHaveCount(1);
  // On a touch screen the frame narrows the page once it's there: measure once it has.
  let was = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await page.getByRole("main").boundingBox());
        const still = now === was;
        was = now;
        return still;
      },
      { intervals: [250] },
    )
    .toBe(true);
  expect(await footGap(page)).toBeGreaterThanOrEqual(12);
  await lengthen(middle(page));
  await staysPut(pinned, () => scrollToEnd(middle(page)));
  // Nothing else scrolls: the panel the page sits on, or the window.
  expect(
    await page.locator("main").evaluate((main) => {
      const panel = main.parentElement;
      return {
        panel: panel === null ? 0 : panel.scrollHeight - panel.clientHeight,
        window: window.scrollY,
      };
    }),
  ).toEqual({ panel: 0, window: 0 });
};

const title = (page: Page) => page.getByRole("heading", { level: 1 });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Workspace tabs" });
const button = (page: Page, name: string | RegExp) =>
  page.getByRole("main").getByRole("button", { name, exact: typeof name === "string" });
/** A code workspace's connections line, under its name, which opens Connections. */
const connectionsLine = (page: Page) => button(page, /Paper/);

/**
 * The message box, in the page's own foot on a desktop; on a touch screen it docks in the frame,
 * which never scrolls, so the page has none to check.
 */
const messageBox = (page: Page, desktop: boolean) =>
  desktop ? [page.getByRole("main").getByRole("textbox", { name: "Message", exact: true })] : [];

const screens = (desktop: boolean) => {
  test("Home keeps its title and foot rows, and only the tiles scroll", async ({ page }) => {
    await page.route("**/api/backup", (route) =>
      route.fulfill({ json: { kind: "behind", since: new Date().toISOString(), reason: "x" } }),
    );
    await page.goto("/");
    const problem = page.getByRole("region", { name: "Problem" });
    await expect(problem).toBeVisible();
    await expect(middle(page).getByRole("list", { name: "Workspaces" })).toBeVisible();
    await keepsPinned(page, [title(page), problem]);
  });

  test("a planning workspace keeps its title, its tabs and its message box", async ({ page }) => {
    await page.goto("/workspaces/garage-gym#knows");
    await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
    await keepsPinned(page, [title(page), tabs(page), ...messageBox(page, desktop)]);
  });

  test("a code workspace keeps its title, its connections line and its message box", async ({
    page,
  }) => {
    await page.goto("/workspaces/workbench");
    await keepsPinned(page, [title(page), connectionsLine(page), ...messageBox(page, desktop)]);
  });

  test("a session keeps its back link, its title and its message box", async ({ page }) => {
    await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
    await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");
    await keepsPinned(page, [
      page.getByRole("link", { name: /^Back to/ }),
      title(page),
      ...messageBox(page, desktop),
    ]);
  });

  test("a document keeps its title, Rename and Delete", async ({ page }) => {
    await newWorkspace(page, `Loft ${Date.now()}`);
    await startSaving(page, "save document\n# Loft plan\n\n- Boards\n- Ladder");
    await page
      .getByRole("list", { name: "Documents saved" })
      .getByRole("link", { name: "Open" })
      .click();
    await expect(title(page)).toHaveText("Loft plan");
    await keepsPinned(page, [title(page), button(page, "Rename"), button(page, "Delete")]);
  });

  test("a Thing keeps its title", async ({ page }) => {
    const name = `Shed ${Date.now()}`;
    await newWorkspace(page, name);
    await startSaving(page, "thing add: name Lawnmower | status have");
    await page.getByRole("link", { name: `Back to ${name}` }).click();
    await tabs(page)
      .getByRole("link", { name: /^Things/ })
      .click();
    await middle(page)
      .getByRole("link", { name: /^Lawnmower/ })
      .click();
    await expect(title(page)).toHaveText("Lawnmower");
    await keepsPinned(page, [page.getByRole("link", { name: /^Back to/ }), title(page)]);
  });

  test("Tidy keeps its title, and Save and Cancel", async ({ page }) => {
    const name = `Attic ${Date.now()}`;
    await newWorkspace(page, name);
    // Markers at the ends of lines script the fake's tidy.
    await startSaving(
      page,
      ["save fact: Pitched roof (merge)", "save fact: The roof is pitched (merge)"].join("\n"),
    );
    await page.getByRole("link", { name: `Back to ${name}` }).click();
    await openWhatCourtyardKnows(page);
    await page.getByRole("link", { name: "Tidy", exact: true }).click();
    await expect(page.getByRole("list", { name: "Proposed changes" })).toBeVisible();
    await keepsPinned(page, [title(page), button(page, /^Save \d/), button(page, "Cancel")]);
  });

  test("Recent changes keeps its back link and title", async ({ page }) => {
    await page.goto("/changes?workspace=garage-gym");
    await keepsPinned(page, [title(page), page.getByRole("link", { name: /^Back to/ })]);
  });

  test("New workspace keeps its title and Add workspace, and Create for code", async ({ page }) => {
    await page.goto("/new-workspace");
    await keepsPinned(page, [title(page), button(page, "Add workspace")]);
    await page.locator("label", { has: page.getByRole("radio", { name: "Code" }) }).click();
    await keepsPinned(page, [title(page), button(page, /^Create/)]);
  });

  test("Fresh start keeps its title and Start fresh", async ({ page }) => {
    await page.goto("/fresh-start");
    await keepsPinned(page, [title(page), button(page, "Start fresh")]);
  });

  test("Settings keeps its title", async ({ page }) => {
    await page.goto("/settings");
    await keepsPinned(page, [title(page)]);
  });
};

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  screens(true);

  test("a sheet keeps its title and Done", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Change icon" }).click();
    const sheet = page.getByRole("dialog", { name: "Icon" });
    const body = sheet.locator("[data-dialog-body]");
    await lengthen(body);
    await staysPut(
      [sheet.getByRole("heading", { name: "Icon" }), sheet.getByRole("button", { name: "Done" })],
      () => scrollToEnd(body),
    );
  });

  test("the Connections dialog keeps its title and Connect", async ({ page }) => {
    await page.goto("/workspaces/workbench");
    await connectionsLine(page).click();
    const dialog = page.getByRole("dialog", { name: "Connections" });
    const connect = dialog.getByRole("button", { name: /^(Connect|Make)/ });
    await expect(connect).toBeVisible();
    const body = dialog.locator("[data-dialog-body]");
    await lengthen(body);
    await staysPut([dialog.getByRole("heading", { name: "Connections" }), connect], () =>
      scrollToEnd(body),
    );
  });
});

test.describe("on a tablet", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });
  screens(false);
});
