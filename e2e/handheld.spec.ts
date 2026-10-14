import { expect, type Page, test } from "@playwright/test";
import { READING_SESSION_ID } from "./long-session.ts";
import { fromTheEnd, pageScroll, scrollPageTo, scrollPageToMiddle } from "./page-scroll.ts";

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

/**
 * Where the page is on a tablet, once the frame (which loads after the page) has its rails in
 * place either side of it: between the workspace tiles and the Talk key.
 */
const besideTheRails = async (page: Page) => {
  const workspaces = page.getByRole("navigation", { name: "Workspaces" });
  const talk = page.getByRole("button", { name: "Talk", exact: true });
  const main = page.getByRole("main");
  await expect
    .poll(async () => {
      const [left, right, content] = [
        await boxOf(workspaces),
        await boxOf(talk),
        await boxOf(main),
      ];
      return content.x >= left.x + left.width - 1 && content.x + content.width <= right.x + 1;
    })
    .toBe(true);
  return boxOf(main);
};

/**
 * Where the page is while the frame is still loading, and where it is once the frame is there
 * (#271): the frame's code is held back until the first is measured.
 */
const beforeAndAfterTheFrame = async (page: Page) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/handheld-frame-*.js", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/workspaces/garage-gym");
  const before = await boxOf(page.getByRole("main"));
  await expect(page.getByRole("navigation", { name: "Workspaces" })).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Skills" })).toBeVisible();
  // Two frames, so anything the frame's arrival moves has moved.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  return { before, after: await boxOf(page.getByRole("main")) };
};

/** The line at the Skills sheet's foot (#201): the model a message goes with, and Change. */
const changeModel = (sheet: ReturnType<Page["locator"]>) =>
  sheet.getByRole("button", { name: /Change$/ });

/** A choice in one of a sheet's radio groups, as a finger taps it: its whole row or tile. */
const choiceIn = (group: ReturnType<Page["locator"]>, name: string | RegExp) =>
  group.locator("label", { has: group.page().getByRole("radio", { name }) });

const effortsOf = (levels: readonly string[]) =>
  levels.map((id) => ({
    id,
    label:
      { medium: "Medium", xhigh: "Extra high" }[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
  }));
const CAN = {
  readsFiles: true,
  codes: true,
  usesTools: true,
  savesContext: true,
  searchesWeb: true,
};
const CLAUDE_EFFORTS = effortsOf(["low", "medium", "high", "xhigh", "max"]);
const CODEX_EFFORTS = effortsOf(["low", "medium", "high", "xhigh"]);
/** The longest-named model the real providers offer, much as Codex names one. */
const LONGEST = "GPT-5.5-codex-long-context-experimental";
const CODEX_NAMES = [
  "GPT-6.1",
  "GPT-6-codex",
  "GPT-6.1-codex-max",
  "GPT-6-codex-mini",
  "GPT-5.6-codex",
  "GPT-5.6 Thinking (extended reasoning preview)",
  LONGEST,
];

/**
 * The providers offering as many models, as long-named, as the real Claude and Codex do (#201):
 * Claude Code's default (Opus 5.5) and four named models, and Codex's seven.
 */
const offerManyModels = (page: Page) =>
  page.route("**/api/providers", (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: "claude",
            label: "Claude",
            available: true,
            capabilities: CAN,
            models: [
              ["default", "Opus 5.5"],
              ["opus", "Opus 5.5"],
              ["fable", "Fable 5.1"],
              ["sonnet", "Sonnet 5.5"],
              ["haiku", "Haiku 4.5"],
            ].map(([id, name]) => ({
              id,
              label: id === "default" ? `Claude · Default (${name})` : `Claude · ${name}`,
              name,
              ...(id === "default" ? { followsDefault: true } : {}),
              efforts: CLAUDE_EFFORTS,
            })),
          },
          {
            id: "codex",
            label: "Codex",
            available: true,
            capabilities: CAN,
            models: CODEX_NAMES.map((name) => ({
              id: name.toLowerCase().replaceAll(/[^a-z0-9.-]+/g, "-"),
              label: `Codex · ${name}`,
              name,
              efforts: CODEX_EFFORTS,
              defaultEffort: "medium",
            })),
          },
        ],
      },
    }),
  );

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

type Screen = "unfolded" | "cover";

/**
 * Puts the keyboard in the message box: on a tablet it's always there; on the cover screen Type
 * opens it.
 */
const typeIn = (page: Page, screen: Screen) =>
  screen === "cover" ? page.getByRole("button", { name: "Type" }).click() : message(page).click();

/** What both screens offer, the same way. */
const everywhere = (screen: Screen) => {
  test("every workspace is a tap away, and holding the open one shows its recent sessions", async ({
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

    await workspaces.getByRole("link", { name: "Garage gym" }).dispatchEvent("contextmenu");
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

  test("tapping the open workspace from one of its sessions goes back to its page", async ({
    page,
  }) => {
    await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });

    await workspaces.getByRole("link", { name: "Garage gym" }).click();

    await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
    await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Garage gym" })).toHaveCount(0);
  });

  test("only where the owner is shows as chosen, ringed in violet, a code workspace's tile too, and on Home the mark (#237)", async ({
    page,
  }) => {
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    const VIOLET = "rgb(157, 107, 255)";
    /** How a tile or the mark looks: its ring and glow, and its fill. */
    const lookOf = (name: string) =>
      workspaces.getByRole("link", { name, exact: true }).evaluate((link) => ({
        ring: getComputedStyle(link).boxShadow,
        fill: getComputedStyle(link).backgroundColor,
      }));
    const tiles = ["Reading list", "Side project", "Garage gym"];

    // Closed, a code workspace's tile looks as any other: no ring, no tint.
    await page.goto("/workspaces/garage-gym");
    await expect(workspaces.getByRole("link", { name: "Garage gym" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const reading = await lookOf("Reading list");
    expect(reading.ring).toBe("none");
    expect(await lookOf("Side project")).toEqual(reading);
    expect((await lookOf("Home")).ring).toBe("none");
    expect((await lookOf("Garage gym")).ring).toContain(VIOLET);

    // Open, it's ringed in violet as any other.
    await page.goto("/workspaces/side-project");
    await expect(workspaces.getByRole("link", { name: "Side project" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect((await lookOf("Side project")).ring).toContain(VIOLET);
    expect(await lookOf("Garage gym")).toEqual(reading);

    // On Home, the mark is.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    expect((await lookOf("Home")).ring).toContain(VIOLET);
    for (const name of tiles) expect(await lookOf(name)).toEqual(reading);
  });

  test("the recent sessions start a new session, with the workspace's message box open for it", async ({
    page,
  }) => {
    await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    await workspaces.getByRole("link", { name: "Garage gym" }).dispatchEvent("contextmenu");
    const recent = page.getByRole("dialog", { name: "Garage gym" });
    await recent.getByRole("button", { name: "New session" }).click();

    await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
    await expect(recent).toBeHidden();
    await expect(message(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Talk into the box" })).toBeVisible();

    // From the workspace's own page, too: on the cover screen, with the box closed by then.
    await page.getByRole("heading", { level: 1 }).click();
    if (screen === "cover") await expect(message(page)).toBeHidden();
    await workspaces.getByRole("link", { name: "Garage gym" }).dispatchEvent("contextmenu");
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

  test("Skills and Model open their pickers", async ({ page }) => {
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
    // Each choice is a row or a tile to tap, holding its radio button.
    const tile = (group: string, name: string | RegExp) =>
      choiceIn(model.getByRole("radiogroup", { name: group }), name);
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

    // A photo or a file: the Reply box's + (#251), not the frame's.
    await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Photo", exact: true })).toHaveCount(0);
    await typeIn(page, screen);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add a photo or file" }).click();
    expect((await chooser).isMultiple()).toBe(true);
  });

  test("the Reply box is +, the words and the mic, which becomes Send: skills and the model come from the frame's buttons", async ({
    page,
  }) => {
    // A workspace's box, which starts a session, and a session's.
    for (const [where, button] of [
      ["/workspaces/garage-gym", "Start"],
      [`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`, "Send"],
    ] as const) {
      await page.goto(where);
      await typeIn(page, screen);
      await expect(message(page)).toBeFocused();
      const box = page.locator("form", { has: message(page) });
      const buttons = () =>
        box.getByRole("button").evaluateAll((all) => all.map((b) => b.ariaLabel));
      expect(await buttons()).toEqual(["Add a photo or file", "Talk into the box"]);
      await expect(box.getByRole("combobox")).toHaveCount(0);
      await message(page).fill("Where should the rack go?");
      expect(await buttons()).toEqual(["Add a photo or file", button]);
      await message(page).fill("");
    }
  });

  test("a / in the empty box opens the Skills sheet, narrowing as the owner types, and Enter picks", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await typeIn(page, screen);
    await page.keyboard.type("/");
    const skills = page.getByRole("dialog", { name: "Skills" });
    await expect(skills).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.keyboard.type("gril");
    await expect(message(page)).toHaveValue("/gril");
    await expect(skills.getByRole("list", { name: "Skills" }).getByRole("button")).toHaveText([
      /^Grilling/,
    ]);
    await page.keyboard.press("Enter");
    await expect(skills).toBeHidden();
    await expect(page.getByText("Skill: Grilling")).toBeVisible();
    await expect(message(page)).toHaveValue("");
    await expect(message(page)).toBeFocused();

    // Back past the `/`, it's the box again, with the sheet gone.
    await page.keyboard.type("/");
    await expect(skills).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(skills).toBeHidden();
    await expect(message(page)).toHaveValue("");
    await expect(message(page)).toBeFocused();
  });

  test("with as many models as the providers offer, Model lists each by its full name, by provider", async ({
    page,
  }) => {
    await offerManyModels(page);
    await page.goto("/workspaces/garage-gym");

    // The Skills sheet's foot says the model, its provider and effort, and changes it.
    await page.getByRole("button", { name: "Skills" }).click();
    const skills = page.getByRole("dialog", { name: "Skills" });
    await expect(changeModel(skills)).toContainText("Opus 5.5");
    await expect(changeModel(skills)).toContainText("Claude · default effort");
    await changeModel(skills).click();
    await expect(skills).toBeHidden();
    const sheet = page.getByRole("dialog", { name: "Model" });
    await expect(sheet).toBeVisible();
    const models = sheet.getByRole("radiogroup", { name: "Model" });

    // Claude Code's default is the model it resolves to, once, saying so, and chosen.
    const opus = models.getByRole("radio", { name: /^Opus 5\.5/ });
    await expect(opus).toHaveCount(1);
    await expect(opus).toBeChecked();
    await expect(choiceIn(models, /^Opus 5\.5/)).toContainText("Claude's default");

    // By provider: each of Claude's; Codex's first few, the rest folded under a line.
    await expect(models.getByRole("group", { name: "Claude" }).getByRole("radio")).toHaveCount(4);
    const codex = models.getByRole("group", { name: "Codex" });
    await expect(codex.getByRole("radio")).toHaveCount(3);
    await codex.getByRole("button", { name: "4 more Codex models" }).click();
    await expect(codex.getByRole("radio")).toHaveCount(7);

    // Every name whole, never cut short, and inside the sheet.
    const edges = await boxOf(sheet);
    for (const name of ["Fable 5.1", "Sonnet 5.5", "Haiku 4.5", ...CODEX_NAMES]) {
      const text = models.getByText(name, { exact: true });
      await text.scrollIntoViewIfNeeded();
      expect(await text.evaluate((shown) => shown.scrollWidth <= shown.clientWidth)).toBe(true);
      const box = await boxOf(text);
      expect(box.x).toBeGreaterThanOrEqual(edges.x);
      expect(box.x + box.width).toBeLessThanOrEqual(edges.x + edges.width);
    }

    // Effort: Default and each level, on one line at the sheet's foot.
    const effort = sheet.getByRole("radiogroup", { name: "Effort" });
    await expect(effort).toBeInViewport();
    const tiles = effort.locator("label");
    await expect(tiles).toHaveText(["Default", "Low", "Med", "High", "XHigh", "Max"]);
    const tops = await tiles.evaluateAll((all) =>
      all.map((tile) => tile.getBoundingClientRect().top),
    );
    expect(new Set(tops).size).toBe(1);

    // Picking one, the longest named.
    await choiceIn(models, LONGEST).tap();
    await expect(models.getByRole("radio", { name: LONGEST })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: `Model: ${LONGEST}` })).toBeVisible();

    // The chosen one is never folded away.
    await page.getByRole("button", { name: /^Model: / }).click();
    await expect(models.getByRole("radio", { name: LONGEST })).toBeChecked();
    await expect(codex.getByRole("radio")).toHaveCount(4);
    await expect(codex.getByRole("button", { name: "3 more Codex models" })).toBeVisible();
    await page.keyboard.press("Escape");
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

  test.describe("while the frame loads", () => {
    // The service worker would serve the frame's code itself, past the hold.
    test.use({ serviceWorkers: "block" });

    test("the page is already beside where the rails will be, so it doesn't jump when they arrive", async ({
      page,
    }) => {
      const { before, after } = await beforeAndAfterTheFrame(page);
      expect(before.x).toBeCloseTo(after.x, 0);
      expect(before.x + before.width).toBeCloseTo(after.x + after.width, 0);
    });

    test("what's typed in the message box as soon as it shows stays, and typing carries on once the frame is there (#359)", async ({
      page,
    }) => {
      await page.route("**/assets/handheld-frame-*.js", async (route) => {
        await new Promise((done) => setTimeout(done, 2_000));
        await route.continue();
      });
      await page.goto("/workspaces/garage-gym");
      const message = page.getByRole("textbox", { name: "Message" });
      await message.click();
      await page.keyboard.type("About the");
      await expect(page.getByRole("button", { name: "Talk", exact: true })).toBeVisible();
      await page.keyboard.type(" bench:");
      await expect(message).toHaveValue("About the bench:");
    });
  });

  test("the Model button shows the model it sends with by its short name, inside the button", async ({
    page,
  }) => {
    // The providers as the worker lists them with Claude and Codex signed in (#200).
    const capabilities = {
      readsFiles: true,
      codes: true,
      usesTools: true,
      savesContext: true,
      searchesWeb: true,
    };
    const model = (id: string, name: string, more: object = {}) => ({
      id,
      label: name,
      name,
      efforts: [],
      ...more,
    });
    await page.route("**/api/providers", (route) =>
      route.fulfill({
        json: {
          providers: [
            {
              id: "claude",
              label: "Claude",
              available: true,
              capabilities,
              models: [
                model("default", "Opus 5.5", { followsDefault: true }),
                model("sonnet", "Sonnet 5"),
              ],
            },
            {
              id: "codex",
              label: "Codex",
              available: true,
              capabilities,
              models: [model("gpt-6.1-sol", "GPT-6.1-Sol")],
            },
            {
              id: "fake",
              label: "Fake",
              available: true,
              capabilities,
              models: [model("echo", "Fake")],
            },
          ],
        },
      }),
    );
    await page.goto("/workspaces/garage-gym");
    const button = page.getByRole("button", { name: /^Model: / });
    const sheet = page.getByRole("dialog", { name: "Model" });

    for (const [name, short] of [
      ["Opus 5.5", "O5.5"],
      ["Sonnet 5", "S5"],
      ["GPT-6.1-Sol", "G6.1S"],
      ["Fake", "F"],
    ] as const) {
      await button.click();
      await sheet
        .getByRole("radiogroup", { name: "Model" })
        .locator("label", { has: page.getByRole("radio", { name: new RegExp(`^${name}`) }) })
        .tap();
      await page.keyboard.press("Escape");
      await expect(button).toHaveAccessibleName(`Model: ${name}`);
      // The disc, and its label: the short name, never spilling out of the disc.
      const disc = button.locator("span").first();
      await expect(disc).toHaveText(short);
      const { label, room } = await disc.evaluate((element) => {
        const text = document.createRange();
        text.selectNodeContents(element);
        const label = text.getBoundingClientRect();
        const room = element.getBoundingClientRect();
        return {
          label: { left: label.left, right: label.right },
          room: { left: room.left, right: room.right },
        };
      });
      expect(label.left).toBeGreaterThanOrEqual(room.left);
      expect(label.right).toBeLessThanOrEqual(room.right);
    }
  });

  test("the right rail is labelled buttons, Model, Skills and a quieter Settings, with the Talk key in the bottom-right corner and no Type", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const content = await besideTheRails(page);
    const model = page.getByRole("button", { name: /^Model: / });
    const skills = page.getByRole("button", { name: "Skills" });
    const settings = page.getByRole("button", { name: "Settings" });
    const rail = [model, skills, settings];
    // Each says what it is; Model with the model's mark before it.
    await expect(model).toContainText(/Model$/);
    await expect(skills).toHaveText("Skills");
    await expect(settings).toHaveText("Settings");

    // Top down in that order, beside the page, in the top half, each a thumb's size.
    let below = 0;
    for (const button of rail) {
      const box = await boxOf(button);
      expect(box.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
      expect(box.y).toBeGreaterThanOrEqual(below);
      expect(box.height).toBeGreaterThanOrEqual(44);
      below = box.y + box.height;
    }
    expect(below).toBeLessThan(UNFOLDED.height / 2);

    // The Talk key, big, in the corner under the right thumb.
    const talk = await boxOf(page.getByRole("button", { name: "Talk", exact: true }));
    expect(talk.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
    expect(talk.x + talk.width).toBeGreaterThan(UNFOLDED.width - 30);
    expect(talk.y + talk.height).toBeGreaterThan(UNFOLDED.height - 30);
    expect(talk.height).toBeGreaterThanOrEqual(200);
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toContainText(
      "TalkHold to speak",
    );
    await expect(page.getByRole("button", { name: "Type" })).toHaveCount(0);
  });

  test("the message box is always there at the foot of the page, between the rails", async ({
    page,
  }) => {
    for (const where of [
      "/workspaces/garage-gym",
      `/workspaces/garage-gym/sessions/${READING_SESSION_ID}`,
    ]) {
      await page.goto(where);
      await expect(message(page)).toBeVisible();
      const content = await besideTheRails(page);
      const box = await boxOf(page.locator("form", { has: message(page) }));
      expect(box.x).toBeGreaterThanOrEqual(content.x);
      expect(box.x + box.width).toBeLessThanOrEqual(content.x + content.width);
      expect(box.y + box.height).toBeGreaterThan(UNFOLDED.height - 40);
      // One line to start: the message and its button side by side.
      expect(box.height).toBeLessThan(70);
    }

    // Sent, or tapped away from, it stays.
    await page.goto("/workspaces/garage-gym");
    await message(page).fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(session(page)).toContainText("You said: Where should the rack go?");
    await expect(message(page)).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(message(page)).toBeVisible();

    // Not on a page without one.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
    await expect(message(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toBeDisabled();
  });

  test("Skills opens a sheet from the right edge, beside the right rail and over the page, with the model at its foot", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const content = await besideTheRails(page);
    const rail = await boxOf(page.getByRole("button", { name: "Settings" }));
    const reply = await boxOf(page.locator("form", { has: message(page) }));
    await page.getByRole("button", { name: "Skills" }).click();
    const sheet = page.getByRole("dialog", { name: "Skills" });
    await expect(sheet).toBeVisible();

    const box = await boxOf(sheet);
    expect(box.x + box.width).toBeLessThanOrEqual(rail.x + 1);
    expect(box.x + box.width).toBeGreaterThanOrEqual(content.x + content.width - 1);
    // A sheet beside the page, not over all of it, and clear of the Reply box under it.
    expect(box.width).toBeLessThan(content.width * 0.6);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(reply.y);
    // The skills, each with what it's for, then at its foot one line for the model (#201).
    const skills = await boxOf(sheet.getByRole("list", { name: "Skills" }));
    const model = await boxOf(changeModel(sheet));
    expect(skills.y).toBeLessThan(model.y);
    expect(model.y).toBeGreaterThan(box.y + box.height * 0.75);
    expect(model.y + model.height).toBeLessThanOrEqual(box.y + box.height);
    await expect(sheet.getByRole("radiogroup")).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: /^Programme check/ })).toBeEnabled();
    await expect(sheet.getByRole("button", { name: /^Ride log chart/ })).toBeDisabled();

    await sheet.getByRole("button", { name: /^Grilling/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Skill: Grilling")).toBeVisible();
  });

  test("each tile shows its workspace's icon, violet while open, and the Icon sheet opens beside the right rail", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const rail = page.getByRole("navigation", { name: "Workspaces" });
    const icon = (name: string) =>
      rail.getByRole("link", { name }).locator("svg[data-workspace-icon]");
    await expect(icon("Garage gym")).toHaveAttribute("data-workspace-icon", "dumbbell");
    await expect(icon("Side project")).toHaveAttribute("data-workspace-icon", "code");
    // White, and violet on the open one (Paper board Handheld · 36).
    const colourOf = (name: string) => icon(name).evaluate((svg) => getComputedStyle(svg).color);
    expect(await colourOf("Garage gym")).toBe("rgb(185, 148, 255)");
    expect(await colourOf("office")).not.toBe("rgb(185, 148, 255)");

    const settings = await boxOf(page.getByRole("button", { name: "Settings" }));
    await page.getByRole("button", { name: "Change icon" }).click();
    const sheet = page.getByRole("dialog", { name: "Icon" });
    await expect(sheet).toBeVisible();
    const box = await boxOf(sheet);
    expect(box.x + box.width).toBeLessThanOrEqual(settings.x + 1);
    const icons = sheet.getByRole("radiogroup", { name: "Icon" });
    await expect(icons.getByRole("radio", { checked: true })).toHaveAccessibleName("Dumbbell");
    // Each a thumb's size.
    const tile = await boxOf(choiceIn(icons, "Music"));
    expect(tile.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
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

  test("only the centre scrolls, its scroll bar inside it, and the rails and the message box stay put", async ({
    page,
  }) => {
    const talk = page.getByRole("button", { name: "Talk", exact: true });
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    const title = page.getByRole("heading", { level: 1 });

    // A long page: what the workspace knows, with its Skills.
    await page.goto("/workspaces/garage-gym#knows");
    await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
    const content = await besideTheRails(page);
    const [rail, key, box] = [
      await boxOf(workspaces),
      await boxOf(talk),
      await boxOf(page.locator("form", { has: message(page) })),
    ];
    const titleAt = await boxOf(title);
    await page.mouse.move(content.x + content.width / 2, UNFOLDED.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await pageScroll(page)).scrollTop).toBeGreaterThan(100);

    // The title stays put above what scrolls (#339).
    const scroll = await pageScroll(page);
    expect(scroll).toMatchObject({ document: false, scrolls: true, windowScrollY: 0 });
    expect(await boxOf(title)).toEqual(titleAt);
    expect(scroll.top).toBeGreaterThanOrEqual(titleAt.y + titleAt.height);
    // Its scroll bar sits on the centre's own edge, inside the right rail, and what scrolls stops
    // short of the message box.
    expect(scroll.right).toBeLessThanOrEqual(key.x + 1);
    expect(scroll.bottom).toBeLessThanOrEqual(box.y + 1);
    expect(await boxOf(workspaces)).toEqual(rail);
    expect(await boxOf(talk)).toEqual(key);
    expect(await boxOf(page.locator("form", { has: message(page) }))).toEqual(box);

    // A long session: it opens at the end, reading back moves only the centre, and Jump to latest
    // brings it back to the end.
    await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
    await expect(session(page)).toContainText("You said:");
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);
    expect((await pageScroll(page)).windowScrollY).toBe(0);
    await page.mouse.move(content.x + content.width / 2, UNFOLDED.height / 2);
    await page.mouse.wheel(0, -900);
    await expect.poll(() => fromTheEnd(page)).toBeGreaterThan(400);
    expect(await pageScroll(page)).toMatchObject({ document: false, windowScrollY: 0 });
    expect(await boxOf(talk)).toEqual(key);

    await page.getByRole("button", { name: /Jump to latest/ }).click();
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);
    expect((await pageScroll(page)).windowScrollY).toBe(0);
  });

  test("a new page starts at its top, and going back returns to where the last one was", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym#knows");
    await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
    // Once the frame is there: its rails narrow the page, which moves what's in it.
    await besideTheRails(page);
    await scrollPageTo(page, 400);
    await expect.poll(async () => (await pageScroll(page)).scrollTop).toBe(400);

    // Away and back again by the tiles: the workspace's page is new again, so at its top.
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    await workspaces.getByRole("link", { name: "Side project" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Side project");
    await workspaces.getByRole("link", { name: "Garage gym" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Garage gym");
    await expect.poll(async () => (await pageScroll(page)).scrollTop).toBe(0);

    // Back twice, to where it was the first time.
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Side project");
    await page.goBack();
    await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
    await expect.poll(async () => (await pageScroll(page)).scrollTop).toBe(400);
    expect((await pageScroll(page)).windowScrollY).toBe(0);
  });

  everywhere("unfolded");
});

test.describe("on the cover screen", () => {
  test.use({ viewport: COVER });

  test("workspaces are tiles across the top, and Skills and Model sit above Type and the talk strip", async ({
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

  test.describe("while the frame loads", () => {
    test.use({ serviceWorkers: "block" });

    test("the page is already below where the tiles will be, so it doesn't jump when they arrive", async ({
      page,
    }) => {
      const { before, after } = await beforeAndAfterTheFrame(page);
      expect(before.y).toBeCloseTo(after.y, 0);
    });
  });

  test("only the page scrolls, between the tiles and the bar, which stay put", async ({ page }) => {
    await page.goto("/workspaces/garage-gym#knows");
    await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
    const tiles = page.getByRole("navigation", { name: "Workspaces" });
    // The bar's top row: Skills, Photo and Model.
    const bar = page.getByRole("button", { name: "Skills" });
    const [tilesAt, barAt] = [await boxOf(tiles), await boxOf(bar)];

    await page.mouse.move(COVER.width / 2, COVER.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await pageScroll(page)).scrollTop).toBeGreaterThan(100);

    const scroll = await pageScroll(page);
    expect(scroll).toMatchObject({ document: false, windowScrollY: 0 });
    expect(scroll.top).toBeGreaterThanOrEqual(tilesAt.y + tilesAt.height - 1);
    expect(scroll.bottom).toBeLessThanOrEqual(barAt.y);
    expect(await boxOf(tiles)).toEqual(tilesAt);
    expect(await boxOf(bar)).toEqual(barAt);
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
    await expect(changeModel(sheet)).toBeInViewport();
    await expect(sheet.getByRole("radiogroup")).toHaveCount(0);

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

  everywhere("cover");
});

test("folding and unfolding keeps the place in a session and a half-written message", async ({
  page,
}) => {
  await page.setViewportSize(UNFOLDED);
  await page.goto(`/workspaces/garage-gym/sessions/${READING_SESSION_ID}`);
  await expect(session(page)).toContainText("You said:");
  await message(page).fill("Half a thought about the");

  // Reading back: the turn in the middle of the screen stays on screen as the Fold folds and opens.
  // Only the turns near the screen are drawn, a frame or so after it scrolls, so wait for the one
  // across the middle to be there.
  await scrollPageToMiddle(page);
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
  await expect(message(page)).toHaveValue("Half a thought about the");
});

test.describe("on a desktop", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1440, height: 900 } });

  // #197: one frame everywhere. A computer gets the rails and the Talk key, with no sidebar.
  test("the frame is there: tiles on the left rail, the buttons and the Talk key on the right", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const rail = page.getByRole("navigation", { name: "Workspaces" });
    const left = await boxOf(rail);
    const content = await boxOf(page.getByRole("main"));
    expect(left.x + left.width).toBeLessThanOrEqual(content.x);
    for (const name of [/^Model/, /^Skills$/, /^Settings$/])
      await expect(page.getByRole("button", { name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toContainText(
      "Hold Space",
    );
    await expect(page.getByRole("button", { name: "Toggle sidebar" })).toHaveCount(0);
    await expect(message(page)).toBeVisible();
  });
});
