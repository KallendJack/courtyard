import { expect, type Page, test } from "@playwright/test";
import { READING_SESSION_ID } from "./long-session.ts";

// The Handheld frame (#193): on a touch tablet or the unfolded Fold, two thumb rails and a bottom
// bar in place of the sidebar; on a phone or the folded Fold, the cover-screen layout. Desktops
// keep the sidebar (app.spec.ts).

/** The Galaxy Z Fold 8's screens, in CSS pixels: unfolded (4:3, landscape) and folded. */
const UNFOLDED = { width: 950, height: 712 };
const COVER = { width: 400, height: 900 };

/** A touch screen, as the Fold is. */
test.use({ hasTouch: true, isMobile: true });

const boxOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

const message = (page: Page) => page.getByRole("textbox", { name: "Message" });
const session = (page: Page) => page.getByRole("list", { name: "Session" });

type Point = { x: number; y: number };

/** A finger dragged across the screen, from one point to another. */
const swipe = async (page: Page, from: Point, to: Point) => {
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let step = 1; step <= 6; step++) {
    const at = {
      x: from.x + ((to.x - from.x) * step) / 6,
      y: from.y + ((to.y - from.y) * step) / 6,
    };
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at] });
  }
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
};

/**
 * A sheet closes every way the owner might close it (#194): a tap on the page outside it, Escape,
 * and a swipe back the way it came, from a point on it.
 */
const closesEveryWay = async (
  page: Page,
  ways: { outside: readonly Point[]; swipe: (sheet: { x: number; y: number }) => [Point, Point] },
) => {
  await page.goto("/workspaces/garage-gym");
  const skills = page.getByRole("dialog", { name: "Skills" });

  for (const point of ways.outside) {
    await page.getByRole("button", { name: "Skills" }).click();
    await expect(skills).toBeVisible();
    await page.touchscreen.tap(point.x, point.y);
    await expect(skills).toBeHidden();
  }
  await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);

  await page.getByRole("button", { name: "Skills" }).click();
  await expect(skills).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(skills).toBeHidden();

  await page.getByRole("button", { name: "Skills" }).click();
  await expect(skills).toBeVisible();
  const [from, to] = ways.swipe(await boxOf(skills));
  await swipe(page, from, to);
  await expect(skills).toBeHidden();
};

/** What both screens offer, the same way. */
const everywhere = () => {
  test("every workspace is a tap away, and a second tap on the open one shows its recent sessions", async ({
    page,
  }) => {
    await page.goto("/");
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });

    await workspaces.getByRole("link", { name: "Reading list" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Reading list" })).toBeVisible();
    await workspaces.getByRole("link", { name: "Side project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Side project" })).toBeVisible();
    await workspaces.getByRole("link", { name: "Garage gym" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();

    await workspaces.getByRole("link", { name: "Garage gym" }).click();
    const recent = page.getByRole("dialog", { name: "Garage gym" });
    await recent
      .getByRole("region", { name: "Recent in Garage gym" })
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
    await expect(recent).toBeHidden();

    await workspaces.getByRole("link", { name: "Home" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(workspaces.getByRole("link", { name: "New workspace" })).toBeVisible();
  });

  test("the recent sessions start a new session, with the workspace's message box open for it", async ({
    page,
  }) => {
    await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    await workspaces.getByRole("link", { name: "Garage gym" }).click();
    const recent = page.getByRole("dialog", { name: "Garage gym" });
    await recent.getByRole("button", { name: "New session" }).click();

    await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
    await expect(recent).toBeHidden();
    await expect(message(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

    // From the workspace's own page, too.
    await page.getByRole("heading", { level: 1 }).click();
    await expect(message(page)).toBeHidden();
    await workspaces.getByRole("link", { name: "Garage gym" }).click();
    await recent.getByRole("button", { name: "New session" }).click();
    await expect(recent).toBeHidden();
    await expect(message(page)).toBeFocused();
  });

  test("Settings has Update and Log out", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });

    // Update, or how it went once another test has updated (app.spec.ts).
    await expect(settings.getByRole("region", { name: "Updates" })).toContainText(
      /A new version is ready|Updating|Updated to/,
    );
    await expect(settings.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  test("Skills, Photo and Model open their pickers", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");

    await page.getByRole("button", { name: "Skills" }).click();
    const skills = page.getByRole("dialog", { name: "Skills" });
    await skills.getByRole("button", { name: /^Grilling/ }).click();
    await expect(skills).toBeHidden();
    // Picking one opens the box with the skill in it.
    await expect(page.getByText("Skill: Grilling")).toBeVisible();
    await page.getByRole("button", { name: "Skills" }).click();
    await expect(skills.getByRole("button", { name: /^Grilling/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");

    // The other fake from the one it shows: either may be at its limit after another test's turn.
    const modelButton = page.getByRole("button", { name: /^Model: / });
    const other =
      (await modelButton.getAttribute("aria-label")) === "Model: Fake two"
        ? { radio: /^Fake echoes/, name: "Model: Fake" }
        : { radio: /^Fake two/, name: "Model: Fake two" };
    await modelButton.click();
    const model = page.getByRole("dialog", { name: "Model" });
    // Each choice is a tile to tap, holding its radio button.
    const tile = (group: string, name: string | RegExp) =>
      model
        .getByRole("radiogroup", { name: group })
        .locator("label", { has: page.getByRole("radio", { name }) });
    await tile("Model", other.radio).tap();
    await tile("Effort", "High").tap();
    await page.keyboard.press("Escape");
    await expect(model).toBeHidden();
    await expect(page.getByRole("button", { name: other.name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: other.name, exact: true }).click();
    await expect(
      model.getByRole("radiogroup", { name: "Effort" }).getByRole("radio", { name: "High" }),
    ).toBeChecked();
    await page.keyboard.press("Escape");

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    expect((await chooser).isMultiple()).toBe(true);
  });

  // The talk strip listens (talk.spec.ts), opening the box for the words it hears.
  test("Type opens the message box, which closes once the message is sent or the owner taps away", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await expect(message(page)).toBeHidden();

    await page.getByRole("button", { name: "Type" }).click();
    await expect(message(page)).toBeFocused();
    await message(page).fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(session(page)).toContainText("You said: Where should the rack go?");
    await expect(message(page)).toBeHidden();

    await page.getByRole("button", { name: "Type" }).click();
    await expect(message(page)).toBeFocused();
    await message(page).fill("And the bikes?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(session(page)).toContainText("You said: And the bikes?");
    await expect(message(page)).toBeHidden();

    await page.getByRole("button", { name: "Type" }).click();
    await expect(message(page)).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(message(page)).toBeHidden();
  });
};

test.describe("unfolded", () => {
  test.use({ viewport: UNFOLDED });

  test("workspaces are tiles on a thumb rail down the left, beside the page", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    const rail = page.getByRole("navigation", { name: "Workspaces" });

    const left = await boxOf(rail);
    const content = await boxOf(page.getByRole("main"));
    expect(left.x).toBeLessThan(1);
    expect(left.x + left.width).toBeLessThanOrEqual(content.x + 1);
    await expect(rail.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Garage gym" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Toggle sidebar" })).toHaveCount(0);
  });

  test("Settings is at the top of the right rail, and Skills, Photo and Model at its foot, beside the page", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const settings = await boxOf(page.getByRole("button", { name: "Settings" }));
    const content = await boxOf(page.getByRole("main"));
    const model = await boxOf(page.getByRole("button", { name: /^Model/ }));
    const type = await boxOf(page.getByRole("button", { name: "Type" }));

    expect(settings.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
    expect(settings.y).toBeLessThan(UNFOLDED.height * 0.15);
    expect(model.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
    expect(model.y).toBeGreaterThan(UNFOLDED.height * 0.6);
    // Type and the talk strip run along the bottom.
    expect(type.y + type.height).toBeGreaterThan(UNFOLDED.height - 40);
    // Each a thumb's size.
    for (const target of [settings, model, type]) expect(target.height).toBeGreaterThanOrEqual(44);
  });

  test("Skills opens a sheet from the right edge, beside the right rail and over the page, with the model at its foot", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const rail = await boxOf(page.getByRole("button", { name: "Settings" }));
    const content = await boxOf(page.getByRole("main"));
    await page.getByRole("button", { name: "Skills" }).click();
    const sheet = page.getByRole("dialog", { name: "Skills" });
    await expect(sheet).toBeVisible();

    const box = await boxOf(sheet);
    const type = await boxOf(page.getByRole("button", { name: "Type" }));
    expect(box.x + box.width).toBeLessThanOrEqual(rail.x + 1);
    expect(box.x + box.width).toBeGreaterThanOrEqual(content.x + content.width - 1);
    // A sheet beside the page, not over all of it.
    expect(box.width).toBeLessThan(content.width * 0.6);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(type.y);
    // The skills, each with what it's for, then the model and its effort at the foot.
    const skills = await boxOf(sheet.getByRole("list", { name: "Skills" }));
    const models = await boxOf(sheet.getByRole("radiogroup", { name: "Model" }));
    const effort = await boxOf(sheet.getByRole("radiogroup", { name: "Effort" }));
    expect(skills.y).toBeLessThan(models.y);
    expect(models.y).toBeGreaterThan(box.y + box.height / 2);
    expect(effort.y + effort.height).toBeLessThanOrEqual(box.y + box.height);
    await expect(sheet.getByRole("button", { name: /^Programme check/ })).toBeEnabled();
    await expect(sheet.getByRole("button", { name: /^Ride log chart/ })).toBeDisabled();

    await sheet.getByRole("button", { name: /^Grilling/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Skill: Grilling")).toBeVisible();
  });

  test("a sheet closes with a tap on the page or a rail, Escape, or a swipe to the right", async ({
    page,
  }) => {
    await closesEveryWay(page, {
      outside: [
        { x: 300, y: 300 },
        { x: 56, y: 580 },
      ],
      swipe: (sheet) => [
        { x: sheet.x + 120, y: sheet.y + 40 },
        { x: sheet.x + 320, y: sheet.y + 60 },
      ],
    });
  });

  everywhere();
});

test.describe("on the cover screen", () => {
  test.use({ viewport: COVER });

  test("workspaces are tiles across the top, and Skills, Photo and Model sit above Type and the talk strip", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const skills = await boxOf(page.getByRole("button", { name: "Skills" }));
    const tiles = await boxOf(page.getByRole("navigation", { name: "Workspaces" }));
    const content = await boxOf(page.getByRole("main"));
    const type = await boxOf(page.getByRole("button", { name: "Type" }));

    expect(tiles.y + tiles.height).toBeLessThanOrEqual(content.y + 1);
    expect(content.width).toBeGreaterThan(COVER.width * 0.85);
    expect(skills.y + skills.height).toBeLessThanOrEqual(type.y);
    expect(type.y + type.height).toBeGreaterThan(COVER.height - 40);
    for (const target of [skills, type]) expect(target.height).toBeGreaterThanOrEqual(44);
  });

  test("Skills opens as a sheet from the bottom, up to most of the screen, scrolling inside it", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Skills" }).click();
    const sheet = page.getByRole("dialog", { name: "Skills" });
    await expect(sheet).toBeVisible();

    const box = await boxOf(sheet);
    expect(box.x).toBeLessThan(1);
    expect(box.width).toBeGreaterThan(COVER.width - 1);
    expect(box.y + box.height).toBeGreaterThan(COVER.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(COVER.height + 1);
    expect(box.height).toBeLessThanOrEqual(COVER.height * 0.85 + 1);
    await expect(sheet.getByRole("radiogroup", { name: "Model" })).toBeInViewport();

    // The last skill is further down the list than there's room for: it scrolls into view inside.
    const last = sheet.getByRole("button", { name: /^warm-up/ });
    await last.scrollIntoViewIfNeeded();
    const lastBox = await boxOf(last);
    expect(lastBox.y).toBeGreaterThanOrEqual(box.y);
    expect((await boxOf(sheet)).y).toBe(box.y);
  });

  test("a sheet closes with a tap above it, Escape, or a swipe down", async ({ page }) => {
    await closesEveryWay(page, {
      outside: [{ x: 200, y: 40 }],
      swipe: (sheet) => [
        { x: 200, y: sheet.y + 20 },
        { x: 210, y: sheet.y + 220 },
      ],
    });
  });

  everywhere();
});

test("folding and unfolding keeps the place in a session and a half-written message", async ({
  page,
}) => {
  await page.setViewportSize(UNFOLDED);
  await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
  await expect(session(page)).toContainText("You said:");
  await page.getByRole("button", { name: "Type" }).click();
  await message(page).fill("Half a thought about the");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(message(page)).toBeHidden();

  // Reading back: the turn in the middle of the screen stays on screen as the Fold folds and opens.
  // Only the turns near the screen are drawn, a frame or so after it scrolls, so wait for the one
  // across the middle to be there.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  let index = "";
  await expect
    .poll(async () => {
      index = await page.evaluate(() => {
        const turns = [...document.querySelectorAll<HTMLElement>('[aria-label="Session"] > li')];
        const middle = turns.find((turn) => {
          const { top, bottom } = turn.getBoundingClientRect();
          return top <= innerHeight / 2 && bottom > innerHeight / 2;
        });
        return middle?.dataset.index ?? "";
      });
      return index;
    })
    .not.toBe("");
  const reading = session(page).locator(`:scope > li[data-index="${index}"]`);
  await page.setViewportSize(COVER);
  await expect(reading).toBeInViewport();
  await page.setViewportSize(UNFOLDED);
  await expect(reading).toBeInViewport();
  await page.getByRole("button", { name: "Type" }).click();
  await expect(message(page)).toHaveValue("Half a thought about the");
});
