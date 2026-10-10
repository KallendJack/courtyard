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
    const skills = page.getByRole("dialog", { name: "Use a skill" });
    await skills.getByRole("button", { name: /^Grilling/ }).click();
    await expect(skills).toBeHidden();
    // Picking one opens the box with the skill in it.
    await expect(page.getByText("Skill: Grilling")).toBeVisible();

    // The other fake from the one it shows: either may be at its limit after another test's turn.
    const modelButton = page.getByRole("button", { name: /^Model: / });
    const other =
      (await modelButton.getAttribute("aria-label")) === "Model: Fake two"
        ? { value: "fake/echo", name: "Model: Fake" }
        : { value: "fake-two/echo", name: "Model: Fake two" };
    await modelButton.click();
    const model = page.getByRole("dialog", { name: "Model for this session" });
    await model.getByRole("combobox", { name: "Model" }).selectOption(other.value);
    await model.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: other.name, exact: true })).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Photo", exact: true }).click();
    expect((await chooser).isMultiple()).toBe(true);
  });

  // The talk strip listens (talk.spec.ts), and opens the box only where the browser can't.
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
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  const index = await page.evaluate(() => {
    const turns = [...document.querySelectorAll<HTMLElement>('[aria-label="Session"] > li')];
    const middle = turns.find((turn) => turn.getBoundingClientRect().bottom > innerHeight / 2);
    return middle?.dataset.index ?? "";
  });
  const reading = session(page).locator(`:scope > li[data-index="${index}"]`);
  await page.setViewportSize(COVER);
  await expect(reading).toBeInViewport();
  await page.setViewportSize(UNFOLDED);
  await expect(reading).toBeInViewport();
  await page.getByRole("button", { name: "Type" }).click();
  await expect(message(page)).toHaveValue("Half a thought about the");
});
