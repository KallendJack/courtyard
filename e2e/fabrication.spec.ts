import { expect, type Locator, type Page, test } from "@playwright/test";
import { BuildChat, BuildOpened } from "../packages/contract/index.ts";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { goldenHolster } from "../packages/fabrication/print/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";
import { hear, standInSpeechRecognition } from "./speech-recognition.ts";

// Fabrication (#698, ADR 0036): a project step's Build opens in Fabrication, served under
// /fabrication behind Courtyard's login, with a chat in its session. On the Fold (#753; Paper,
// 2 · Agreed, "Fabrication · At the bench · Fold 933×645", "· At the bench · Cover 476×695" and
// "· Plan · Fold 933×645"), one job at a time: At the bench, or Plan; on a computer, the three
// panels ("Fabrication · A Build · Desktop 1440×900 (#698)"). The worker's side is in
// fabrication-chat.test.ts.

const STEP = "Build the workbench";

/** The Fold's two screens, in CSS pixels. */
const UNFOLDED = { width: 933, height: 645 };
const FOLDED = { width: 476, height: 695 };

/** The golden bench, as its step's Build. Not "Workbench": its tile on Home would then match home.spec's seeded Workbench tile. */
const SPLIT_BENCH = { name: "Split bench", template: "framed-bench", parameters: goldenBench };

/**
 * A workspace with a project whose first step owns a Build (the golden bench unless another is
 * given), made as the model makes them: the project in one session, then the Build given to its
 * step in another. Ends on its Home.
 */
const workspaceWithBuild = async (
  page: Page,
  build: { name: string; template: string; parameters: unknown } = SPLIT_BENCH,
) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    `project: ${JSON.stringify({
      name: "Split the garage",
      add_steps: [{ who: "you", text: STEP }],
    })}`,
  );
  await expect(page.getByRole("list", { name: "Projects saved" })).toContainText("Started project");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  // On Home with its project before the next message, so it isn't typed into the session left.
  await expect(page.getByRole("region", { name: "Projects" })).toContainText("Split the garage");
  await startSaving(page, `build: ${JSON.stringify({ ...build, project: "P1", step: "s1" })}`);
  await expect(page.getByRole("list", { name: "Builds saved" })).toContainText("Started Build");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  return name;
};

/** From Home, the project's page, and its step's Open in Fabrication, to the Build `name` at `slug`. */
const openInFabrication = async (page: Page, name = "Split bench", slug = "split-bench") => {
  await page
    .getByRole("region", { name: "Projects" })
    .getByRole("link", { name: "Split the garage" })
    .click();
  await page
    .getByRole("region", { name: "Next" })
    .getByRole("link", { name: "Open in Fabrication" })
    .click();
  // Your tools comes first while the owner has none saved (your-tools.spec.ts).
  const built = page.getByRole("heading", { level: 1, name });
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(built.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(page).toHaveURL(new RegExp(`/fabrication/workspaces/[^/]+/builds/${slug}$`));
  await expect(built).toBeVisible();
};

/** The golden holster (#702), as a step's printed part. */
const HOLSTER = { name: "Battery holster", template: "battery-holster", parameters: goldenHolster };

/** A workspace whose project's step owns the golden holster, open in Fabrication. */
const holsterOpen = async (page: Page) => {
  await workspaceWithBuild(page, HOLSTER);
  await openInFabrication(page, "Battery holster", "battery-holster");
};

/**
 * The frame timber's options, opened from its buy-list row (#704; Paper, 2 · Agreed, "Fabrication
 * · Choose materials · Tablet (#704)"): the recommended first, each costed, with its shop. Picking
 * CLS works the Build out again, and Undo puts it back.
 */
const pickTheFrameTimber = async (page: Page) => {
  await page.getByRole("tab", { name: "Buy list" }).click();
  await page
    .getByRole("region", { name: "Buy list" })
    .getByRole("button", { name: /45 × 95 C16, 2\.4 m/ })
    .click();
  const options = page.getByRole("region", { name: "Frame timber options" });
  await expect(options).toContainText("Legs, long rails, end rails and shelf support");
  const choices = options.getByRole("listitem");
  await expect(choices).toHaveCount(3);
  await expect(choices.first()).toContainText("Sawn C16, 45 × 95£34.00");
  await expect(choices.first()).toContainText("Picked · recommended");
  await expect(choices.first().getByRole("link", { name: "Woodstore" })).toHaveAttribute(
    "href",
    "https://shop.example/c16-45x95",
  );
  await expect(choices.nth(2)).toContainText("Not needed indoors");

  await options.getByRole("button", { name: "Pick CLS, 38 × 89" }).click();
  await expect(choices.nth(1)).toContainText("Picked");
  await expect(options).toContainText("Picked CLS, 38 × 89");

  // The Build follows: the buy list's line and total, and the end rails cut 474 long.
  await options.getByRole("button", { name: "Buy list" }).click();
  const buyList = page.getByRole("region", { name: "Buy list" });
  await expect(buyList).toContainText("38 × 89 CLS, 2.4 m");
  await expect(buyList).toContainText("Total £174.52");
  await page.getByRole("tab", { name: "Cut plan" }).click();
  await expect(
    page.getByRole("region", { name: "Cut plan" }).getByRole("button", { name: "C, 474 mm" }),
  ).toHaveCount(4);

  // Undo, from the options, puts the frame back as it was.
  await page
    .getByRole("region", { name: "Cut plan" })
    .getByRole("button", { name: "Options for 38 × 89 CLS" })
    .click();
  await options.getByRole("button", { name: "Undo" }).click();
  await expect(choices.first()).toContainText("Picked · recommended");
  // Back goes where they were opened from.
  await options.getByRole("button", { name: "Cut plan" }).click();
  await expect(page.getByRole("region", { name: "Cut plan" })).toBeVisible();
  await page.getByRole("tab", { name: "Buy list" }).click();
  await expect(page.getByRole("region", { name: "Buy list" })).toContainText("Total £177.02");
};

/** At the bench / Plan, in the top bar on the unfolded Fold: to Plan. */
const toPlan = (page: Page) =>
  page.locator("label", { has: page.getByRole("radio", { name: "Plan" }) }).click();

/** The 3D panel's letter for a part. */
const letter = (page: Page, name: string) =>
  page.getByRole("region", { name: "In 3D" }).getByRole("button", { name, exact: true });

/** The Build's chat as the worker has it, once its first answer (to starting it) has come. */
const chatSettled = async (page: Page) => {
  const api = `${new URL(page.url()).pathname.replace(/^\/fabrication/, "/api/fabrication")}/chat`;
  await expect
    .poll(async () => BuildChat.parse(await (await page.request.get(api)).json()).answering, {
      timeout: 90_000,
    })
    .toBe(false);
};

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("It isn't on screen.");
  return box;
};

/** The letters on the parts, over the 3D view. */
const lettersOn = (page: Page) =>
  page.getByRole("region", { name: "In 3D" }).locator("canvas ~ button");

/** Each pair of the 3D view's letters that overlap, by their names. */
const overlappingLetters = async (page: Page) => {
  const boxes = await Promise.all(
    (await lettersOn(page).all()).map(async (each) => ({
      name: await each.getAttribute("aria-label"),
      box: await boxOf(each),
    })),
  );
  return boxes.flatMap((a, i) =>
    boxes
      .slice(i + 1)
      .filter(
        (b) =>
          a.box.x < b.box.x + b.box.width &&
          b.box.x < a.box.x + a.box.width &&
          a.box.y < b.box.y + b.box.height &&
          b.box.y < a.box.y + a.box.height,
      )
      .map((b) => `${a.name} on ${b.name}`),
  );
};

/**
 * How much of the 3D view's width and height the Build itself spans, from 0 to 1: the view as
 * drawn, with what sits over it hidden, read pixel by pixel for anything brighter than the panel.
 */
const buildFills = async (page: Page) => {
  const view = page.getByRole("region", { name: "In 3D" }).locator("canvas");
  const shot = await view.screenshot({
    style: '[aria-label="In 3D"] .absolute { visibility: hidden !important; }',
  });
  return page.evaluate(async (png) => {
    const picture = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${png}`)).blob(),
    );
    const canvas = new OffscreenCanvas(picture.width, picture.height);
    const drawing = canvas.getContext("2d");
    if (drawing === null) throw new Error("No 2D canvas.");
    drawing.drawImage(picture, 0, 0);
    const { data, width, height } = drawing.getImageData(0, 0, picture.width, picture.height);
    let [left, right, top, bottom] = [width, -1, height, -1];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const bright = ((data[at] ?? 0) + (data[at + 1] ?? 0) + (data[at + 2] ?? 0)) / 3;
        if (bright < 60) continue;
        [left, right] = [Math.min(left, x), Math.max(right, x)];
        [top, bottom] = [Math.min(top, y), Math.max(bottom, y)];
      }
    }
    return { width: (right - left) / width, height: (bottom - top) / height };
  }, shot.toString("base64"));
};

/** A finger swiped across `locator`, to the left or the right. */
const swipe = async (locator: Locator, way: "left" | "right") => {
  const box = await boxOf(locator);
  const y = box.y + box.height / 2;
  const [from, to] =
    way === "left"
      ? [box.x + box.width * 0.8, box.x + box.width * 0.2]
      : [box.x + box.width * 0.2, box.x + box.width * 0.8];
  const at = (x: number) => ({ pointerType: "touch", isPrimary: true, clientX: x, clientY: y });
  await locator.dispatchEvent("pointerdown", at(from));
  await locator.dispatchEvent("pointerup", at(to));
};

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

  test("it opens at the bench: the step big, its tools, Back and Done, and the dots only show how far", async ({
    page,
  }) => {
    const name = await workspaceWithBuild(page);
    await openInFabrication(page);

    await expect(
      page.getByRole("link", { name: `Back to ${name} · Split the garage` }),
    ).toBeVisible();
    const views = page.getByRole("group", { name: "Way of working" });
    await expect(views.getByRole("radio", { name: "At the bench" })).toBeChecked();
    const dots = page.getByRole("progressbar", { name: "Steps" });
    await expect(dots).toHaveAttribute("aria-valuetext", "Step 1 of 12");
    await expect(dots.getByRole("button")).toHaveCount(0);

    const steps = page.getByRole("region", { name: "Steps" });
    await expect(steps).toContainText("Step 1 of 12 · about 10 min");
    await expect(steps.getByRole("heading", { name: "Check what's arrived" })).toBeVisible();
    await expect(
      page.getByText("Swipe for the next step · Tools, cut plan and buy list in Plan"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
    for (const each of ["Done, next step", "Hold to ask", "Reset view"]) {
      await expect(page.getByRole("button", { name: each })).toBeInViewport();
    }
    // The step's lines are read at arm's length: bigger than an answer's.
    const line = steps.getByRole("list", { name: "Checklist" }).locator("p").first();
    expect(Number.parseFloat(await line.evaluate((p) => getComputedStyle(p).fontSize))).toBe(20);
    // Nothing's put on yet: the whole bench shows, fitted to the view, its letters apart.
    await expect(letter(page, "G, Top")).toBeVisible();
    expect(await overlappingLetters(page)).toEqual([]);
    const fills = await buildFills(page);
    expect(Math.max(fills.width, fills.height)).toBeGreaterThan(0.75);

    // A swipe to the left is the next step; to the right, the one before.
    await swipe(steps, "left");
    await expect(dots).toHaveAttribute("aria-valuetext", "Step 2 of 12");
    await swipe(steps, "right");
    await expect(dots).toHaveAttribute("aria-valuetext", "Step 1 of 12");

    // Cutting goes by the tools to hand: the support for the long end, to check, in gold.
    const done = page.getByRole("button", { name: "Done, next step" });
    await done.click();
    await done.click();
    await expect(steps.getByRole("heading", { name: "Cut and label the timber" })).toBeVisible();
    await expect(steps.getByRole("list", { name: "Tools for this step" })).toContainText(
      "Support for the long end?",
    );
    const ways = steps.getByRole("region", { name: "How you'll do it" });
    await expect(ways.getByRole("listitem")).toHaveText([
      "Hand saw",
      "Circular saw · not yet",
      "Mitre saw · not yet",
    ]);
  });

  test("Plan: the Build big in 3D, fitted, letters apart, its cut plan with each offcut, buy list and a part's card", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toPlan(page);

    await expect(page.getByText("1500 × 600 × 900 mm")).toBeVisible();
    // The tools are said once, on their tab, and the bolts given too short are just bought
    // right: nothing's left to check (#763).
    await expect(page.getByRole("button", { name: /to check/ })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "To check" })).toHaveCount(0);

    const bench = page.getByRole("region", { name: "In 3D" });
    await expect(bench.getByRole("heading", { name: "The bench" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
    await expect(letter(page, "B, Long rails")).toBeVisible();
    expect(await overlappingLetters(page)).toEqual([]);
    const fills = await buildFills(page);
    expect(Math.max(fills.width, fills.height)).toBeGreaterThan(0.75);

    // The cut plan, each bar's offcut by its length: in the bar, or on its line when too short.
    const cutPlan = page.getByRole("region", { name: "Cut plan" });
    await expect(cutPlan).toContainText("Each saw cut takes 3 mm · assumed");
    await expect(cutPlan.getByRole("button", { name: "B, 1450 mm" })).toHaveCount(1);
    await expect(cutPlan).toContainText("45 × 95 C16, 2.4 m× 4 · offcut 197");
    await expect(cutPlan).toContainText("× 1 · offcut 88");
    await expect(cutPlan.getByText("offcut 834", { exact: true })).toBeVisible();

    // Every sheet piece shows its size, the narrowest too: on a line of its own, or turned.
    const { derived } = BuildOpened.parse(
      await (
        await page.request.get(
          new URL(page.url()).pathname.replace(/^\/fabrication/, "/api/fabrication"),
        )
      ).json(),
    );
    const [narrowest] = derived.cutPlan.sheets
      .flatMap((sheet) =>
        sheet.sheets.flatMap((each) =>
          each.pieces.map((piece) => ({ ...piece, share: piece.along / sheet.sheetLength })),
        ),
      )
      .sort((a, b) => a.share - b.share);
    if (narrowest === undefined) throw new Error("The bench has no sheet pieces.");
    const size = `${narrowest.along} × ${narrowest.across}`;
    const narrow = cutPlan.getByRole("button", { name: `${narrowest.label}, ${size} mm` }).first();
    expect(narrowest.share).toBeLessThan(0.3);
    expect((await narrow.innerText()).replace(/\s+/g, " ")).toContain(size);
    for (const line of await narrow.locator("span span").all()) {
      const [piece, words] = [await boxOf(narrow), await boxOf(line)];
      expect(words.x).toBeGreaterThanOrEqual(piece.x - 0.5);
      expect(words.x + words.width).toBeLessThanOrEqual(piece.x + piece.width + 0.5);
    }

    // A part's letter lights it in the cut plan too, and opens its card.
    await letter(page, "B, Long rails").click();
    const card = bench.getByRole("region", { name: "B, Long rails" });
    await expect(card).toContainText("Long rails × 4");
    await expect(card).toContainText("Front and back, top and bottom.");
    await expect(card).toContainText("1450 × 95 × 45 mm");
    await expect(card).toContainText("45 × 95 C16, 2.4 m");
    await expect(cutPlan.getByRole("button", { name: "B, 1450 mm" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();

    await page.getByRole("tab", { name: "Buy list" }).click();
    const buyList = page.getByRole("region", { name: "Buy list" });
    await expect(buyList).toContainText("To buy · 11");
    await expect(buyList.getByRole("link", { name: /Wheelwright TD60 castors/ })).toHaveAttribute(
      "href",
      "https://shop.example/td60",
    );
    await expect(buyList).toContainText("Total £177.02");
    // The bolts as the size to buy, never the 50s given, what they pass through a tap away.
    await expect(buyList).toContainText("M6 × 60 bolts");
    await expect(buyList).not.toContainText("M6 × 50");
    await buyList.getByRole("button", { name: "Why 60 mm?" }).click();
    await expect(buyList).toContainText(
      "castor plate 4 + castor base 45 + M6 washer 1.6 + M6 washer 1.6 + M6 lock nut 5 + two threads 2 = 59.2 mm",
    );
  });

  test("Tools: said once, what's to sort first with what to do, a tool added to the buy list (#763)", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toPlan(page);

    await page.getByRole("tab", { name: "Tools" }).click();
    const tools = page.getByRole("region", { name: "Tools" });
    await expect(tools.getByRole("heading", { name: "5 to sort" })).toBeVisible();
    await expect(tools).toContainText("Everything else is to hand.");
    const toSort = tools.getByRole("list", { name: "To sort" });
    const sorting = toSort.getByRole("listitem");
    await expect(toSort.locator("li > div > p:first-child")).toHaveText([
      "Support for the long end",
      "Drill bits: 7 mm and 3 mm",
      "Spanner",
      "Countersink bit",
      "Spirit level",
    ]);
    // Each with what to do: the bits the set has to be checked for, the rest had or bought.
    const bits = sorting.nth(1);
    await expect(bits).toContainText("Check your set has both");
    await expect(bits.getByRole("button", { name: "Have them" })).toBeVisible();
    await bits.getByRole("button", { name: "How do I tell a bit's size?" }).click();
    await expect(bits).toContainText("stamped on the bit's smooth shank");
    const spanner = sorting.nth(2);
    await expect(spanner).toContainText("Fit the castors to the bases · step 4");
    await expect(spanner.getByRole("button", { name: "Have it" })).toBeVisible();
    await spanner.getByRole("button", { name: "Add to list" }).click();
    await expect(spanner).toContainText("On the buy list");
    await expect(tools.getByRole("list", { name: "Also to hand" })).toContainText("Hand saw");

    await page.getByRole("tab", { name: "Buy list" }).click();
    const buyList = page.getByRole("region", { name: "Buy list" });
    await expect(buyList).toContainText("To buy · 12");
    await expect(buyList).toContainText("Spannerstep 4");

    // Its Undo takes it off the list again.
    await page.getByRole("tab", { name: "Tools" }).click();
    await spanner.getByRole("button", { name: "Undo" }).click();
    await expect(spanner.getByRole("button", { name: "Add to list" })).toBeVisible();
  });

  test("Tools: Have it adds to the tools the Build has, before Your tools is saved (#763)", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toPlan(page);

    await page.getByRole("tab", { name: "Tools" }).click();
    const tools = page.getByRole("region", { name: "Tools" });
    const toSort = tools.getByRole("list", { name: "To sort" });
    await toSort
      .getByRole("listitem")
      .filter({ hasText: "Spirit level" })
      .getByRole("button", { name: "Have it" })
      .click();

    // The level's had, and what was to hand stays to hand.
    await expect(tools.getByRole("status")).toContainText("Spirit level saved to Your tools");
    await expect(tools.getByRole("heading", { name: "4 to sort" })).toBeVisible();
    const also = tools.getByRole("list", { name: "Also to hand" });
    for (const tool of ["Hand saw", "Clamps", "Drill driver", "Spirit level"]) {
      await expect(also).toContainText(tool);
    }

    await tools.getByRole("button", { name: "Undo" }).click();
    await expect(tools.getByRole("heading", { name: "5 to sort" })).toBeVisible();
  });

  test("a printed part shows in Plan on the plate with its size, its sources and its file (#702)", async ({
    page,
  }) => {
    await holsterOpen(page);
    if (await page.getByRole("group", { name: "Way of working" }).isVisible()) await toPlan(page);

    await expect(page.getByText("84.4 × 119.2 × 70.2 mm")).toBeVisible();
    await expect(page.getByRole("button", { name: "1 to check" })).toBeVisible();
    await expect(page.getByRole("list", { name: "To check" })).toContainText(
      "Battery width assumed76 mm isn't measured.",
    );

    const plate = page.getByRole("region", { name: "In 3D" });
    await expect(plate.getByRole("heading", { name: "On the plate · 256 mm" })).toBeVisible();
    await expect(plate.locator("canvas")).toHaveCount(1);
    await expect(plate).toContainText(
      "Fits the plate · holes allow 0.2 mm (assumed until the printer's calibrated)",
    );

    await expect(page.getByRole("tablist", { name: "Show" }).getByRole("tab")).toHaveText([
      "Print",
      "Buy list",
    ]);
    const print = page.getByRole("region", { name: "Print" });
    await expect(print).toContainText("Battery width76 mm · assumed");
    await expect(print).toContainText("Battery depth115 mm · measured");
    await expect(print).toContainText("Walls4 mm");
    await expect(print).toContainText("Screw holes2 × 4 mm, countersunk · specified");
    await expect(print).toContainText("battery-holster.3mfready");
    await expect(print.getByRole("link", { name: "Open in Bambu Studio" })).toHaveAttribute(
      "href",
      /\/builds\/battery-holster\/print\/battery-holster\.3mf$/,
    );
    const downloaded = page.waitForEvent("download");
    await print.getByRole("link", { name: "Open in Bambu Studio" }).click();
    expect((await downloaded).suggestedFilename()).toBe("battery-holster.3mf");
    await expect(
      print.getByRole("button", { name: "Send to printer · once you have one" }),
    ).toBeDisabled();

    await page.getByRole("tab", { name: "Buy list" }).click();
    await expect(page.getByRole("region", { name: "Buy list" })).toContainText(
      "4 × 30 mm wood screws",
    );
  });

  test("a buy-list row opens its stock's options in Plan, and a pick changes the Build, with Undo", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toPlan(page);
    await pickTheFrameTimber(page);
  });

  test("the steps build the Build up in 3D, and where the owner got to is kept", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    const steps = page.getByRole("region", { name: "Steps" });
    const done = page.getByRole("button", { name: "Done, next step" });
    for (let step = 1; step < 4; step += 1) await done.click();

    // The castors: the bases alone in 3D, lit; the bolts at the length to use, the 50s given
    // never said (#763); the bit by its size, to check in the owner's set.
    await expect(
      steps.getByRole("heading", { name: "Fit the castors to the bases" }),
    ).toBeVisible();
    await expect(letter(page, "E, Castor bases")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "A, Legs")).toHaveCount(0);
    await expect(steps).toContainText(
      "Fixings: M6 × 60 bolts (16), M6 washers (32) and M6 lock nuts (16)",
    );
    await expect(steps).not.toContainText("M6 × 50");
    const chips = steps.getByRole("list", { name: "Tools for this step" });
    await expect(chips).toContainText("Spanner?");
    await expect(chips).toContainText("a 7 mm bit: check your set");

    // The end frames: one laid flat on the floor, lit; a checklist with words to tap.
    await done.click();
    await expect(steps.getByRole("heading", { name: "Make the two end frames" })).toBeVisible();
    await expect(page.getByRole("region", { name: "In 3D" })).toContainText(
      "Step 5 · Make the two end frames",
    );
    await expect(
      page.getByRole("figure", { name: "One end frame, flat on the floor, in 3D" }),
    ).toBeVisible();
    await expect(letter(page, "A, Legs")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "C, End rails")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "E, Castor bases")).toHaveCount(0);
    await expect(letter(page, "B, Long rails")).toHaveCount(0);
    expect(await overlappingLetters(page)).toEqual([]);
    // Show me how first shows how deep a pilot hole goes, the first step that drills one (#777);
    // the step's own close-up follows.
    const closeUps = page.getByRole("region", { name: "Close-up" });
    await expect(closeUps.first()).toContainText("Close-up · A pilot hole's depth");
    await expect(closeUps.last()).toContainText("Close-up · One end frame");
    await expect(steps).toContainText("Fixings: 5 × 80 screws (16)");
    const checklist = steps.getByRole("list", { name: "Checklist" });
    await checklist.getByRole("checkbox", { name: "Line 1 done" }).click();
    await expect(checklist.getByRole("checkbox", { name: "Line 1 done" })).toBeChecked();
    await checklist.getByRole("button", { name: "flush" }).click();
    await expect(steps.getByRole("status")).toContainText(
      "flush: Level with the next piece's face or edge",
    );
    await expect(steps.getByRole("region", { name: "Before you move on" })).toContainText(
      "Measure corner to corner both ways.",
    );

    // Kept on the Build: opened again, it's where the owner left off.
    const buildApi = new URL(page.url()).pathname.replace(/^\/fabrication/, "/api/fabrication");
    await expect
      .poll(async () => {
        const { progress } = BuildOpened.parse(await (await page.request.get(buildApi)).json());
        return [progress.step, progress.ticked.find((each) => each.step === "end-frames")?.lines];
      })
      .toEqual(["end-frames", [0]]);
    await page.reload();
    await expect(steps.getByRole("heading", { name: "Make the two end frames" })).toBeVisible();
    await expect(checklist.getByRole("checkbox", { name: "Line 1 done" })).toBeChecked();
    await expect(checklist.getByRole("checkbox", { name: "Line 2 done" })).not.toBeChecked();
  });

  test("hold to ask: what's said goes to the Build's chat about the step, and its answer shows over the picture", async ({
    page,
  }) => {
    test.slow();
    await standInSpeechRecognition(page);
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await chatSettled(page);

    const ask = page.getByRole("button", { name: "Hold to ask" });
    const { x, y, width, height } = await boxOf(ask);
    await page.mouse.move(x + width / 2, y + height / 2);
    await page.mouse.down();
    await expect(page.getByRole("button", { name: "Let go to ask" })).toBeVisible();
    await hear(page, "Is the floor level enough?");
    await expect(page.getByRole("status").filter({ hasText: "Is the floor" })).toHaveText(
      "Step 1, Check what's arrived: Is the floor level enough?",
    );
    await page.mouse.up();

    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer).toContainText(
      "You said: Step 1, Check what's arrived: Is the floor level enough?",
      { timeout: 60_000 },
    );
    await answer.getByRole("button", { name: "Open chat" }).click();
    const chat = page.getByRole("dialog", { name: "Chat" });
    await expect(chat.getByRole("list", { name: "Messages" })).toContainText(
      "Step 1, Check what's arrived: Is the floor level enough?",
    );
    await chat.getByRole("button", { name: "Close" }).click();
    await expect(chat).toBeHidden();
  });

  test("hold to ask: an answer that fails says so, with Try again, until it's closed", async ({
    page,
  }) => {
    test.slow();
    await standInSpeechRecognition(page);
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await chatSettled(page);

    const ask = page.getByRole("button", { name: "Hold to ask" });
    const { x, y, width, height } = await boxOf(ask);
    await page.mouse.move(x + width / 2, y + height / 2);
    await page.mouse.down();
    await hear(page, "please fail");
    await page.mouse.up();

    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer.getByRole("alert")).toHaveText("It didn't answer.", { timeout: 60_000 });
    await expect(answer.getByText("Answering…")).toHaveCount(0);
    await expect(answer.getByRole("button", { name: "Try again" })).toBeVisible();
    await answer.getByRole("button", { name: "Close" }).click();
    await expect(answer).toBeHidden();
  });
});

// Each step's picture (#754; Paper, 2 · Agreed, "Fabrication · At the bench · Fold 933×645"): the
// job as it's done, with the Build's numbers drawn on it.

/** The 3D panel's camera, as it says it: turned from the front and up from level, in degrees. */
const camera = async (page: Page) => {
  const picture = page.getByRole("region", { name: "In 3D" }).getByRole("figure");
  return {
    turn: Number(await picture.getAttribute("data-turn")),
    tilt: Number(await picture.getAttribute("data-tilt")),
  };
};

/** On to step `number` from the first, at the bench: Done, next step, until it's there. */
const toStep = async (page: Page, number: number) => {
  const dots = page.getByRole("progressbar", { name: "Steps" });
  for (let at = 1; at < number; at += 1) {
    await page.getByRole("button", { name: "Done, next step" }).click();
    await expect(dots).toHaveAttribute("aria-valuetext", new RegExp(`^Step ${at + 1} of`));
  }
};

/** A drag across the picture, from its left edge, clear of the letters, by so many pixels. */
const drag = async (page: Page, by: { x: number; y: number }) => {
  const box = await page.getByRole("region", { name: "In 3D" }).locator("canvas").boundingBox();
  if (box === null) throw new Error("The picture isn't drawn.");
  const from = { x: box.x + 12, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 10 });
  await page.mouse.up();
};

test.describe("each step's picture, on the unfolded Fold", () => {
  test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

  test("the cut step shows the length in the Workmate as the board does, and a part's card closes at the next step", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toStep(page, 3);

    const picture = page.getByRole("figure", { name: "In the Workmate, in 3D" });
    await expect(picture).toContainText("In the Workmate");
    // The 1450 to cut, its line, where the saw runs, the waste side and the long end's support.
    await expect(picture.getByText("1450", { exact: true })).toBeVisible();
    await expect(picture).toContainText("cut at 1450");
    await expect(picture).toContainText("saw here, just past the line");
    await expect(picture).toContainText("offcut · waste side");
    await expect(picture).toContainText("support the long end here");
    await expect(picture).toContainText("clamped in the jaws");
    await expect(
      page.getByRole("region", { name: "In 3D" }).getByRole("button", { name: "Reset view" }),
    ).toBeVisible();
    await expect(letter(page, "B, Long rails")).toHaveAttribute("aria-current", "step");

    // The part's card covers the picture, so the next step closes it.
    await letter(page, "B, Long rails").click();
    const card = page.getByRole("region", { name: "B, Long rails" });
    await expect(card).toContainText("Long rails × 4");
    await page.getByRole("button", { name: "Done, next step" }).click();
    await expect(
      page.getByRole("figure", { name: "A castor base, upside down, in 3D" }),
    ).toBeVisible();
    await expect(card).toBeHidden();
  });

  test("the marking step shows the length on the Workmate with its marks, and a bar per length", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toStep(page, 2);

    const picture = page.getByRole("figure", { name: "On the Workmate, in 3D" });
    await expect(picture).toContainText("B 1450");
    await expect(picture).toContainText("A 750");
    await expect(picture).toContainText("check this end is square");

    // First the end checked square, then a line per length, each with its bar.
    const checklist = page.getByRole("region", { name: "Steps" }).getByRole("list", {
      name: "Checklist",
    });
    await expect(checklist.getByRole("listitem").first()).toContainText(
      "First check the end is square",
    );
    const bars = checklist.getByRole("img");
    await expect(bars).toHaveCount(3);
    await expect(bars.first()).toHaveAccessibleName("B 1450 · 3 mm saw cut · A 750 · offcut 197");
  });

  test("the marking step's Show me how walks through the tape, tick, square and line, with its close-ups (#777)", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toStep(page, 2);

    const steps = page.getByRole("region", { name: "Steps" });
    const walk = steps.getByRole("region", { name: "How it's done" });
    // Its own moves, not the close-ups' notes.
    const moves = walk.locator("ol > li");
    await expect(moves).toHaveCount(4);
    for (const [at, move] of ["1. Tape:", "2. Tick:", "3. Square:", "4. Line:"].entries()) {
      await expect(moves.nth(at)).toContainText(move);
    }
    await expect(moves.nth(1)).toContainText("At 1450");
    // The tape's hook over the end, and the square's stock against the edge, drawn close.
    const closeUps = walk.getByRole("region", { name: "Close-up" });
    await expect(closeUps).toHaveCount(2);
    await expect(closeUps.first()).toContainText("The tape's hook over the end");
    await expect(closeUps.last()).toContainText("The square's stock against the edge");
    await expect(closeUps.last().getByRole("img")).toHaveAccessibleName(/95 mm marked/);

    // Just the numbers leaves it out.
    await steps.getByRole("button", { name: "Just the numbers" }).click();
    await expect(walk).toBeHidden();
    await steps.getByRole("button", { name: "Show me how" }).click();
    await expect(walk).toBeVisible();
  });

  test("the pictures' words are as big as the step's, and none sits on another (#777)", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);

    /** Each mark's words and part's letter over the picture: its size and where it is. */
    const placed = (picture: Locator) =>
      picture.evaluate((figure) =>
        [...figure.querySelectorAll(":scope > span, :scope > button")].map((each) => {
          const box = each.getBoundingClientRect();
          return {
            text: each.textContent ?? "",
            size: Number.parseFloat(getComputedStyle(each).fontSize),
            box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
            mark: each.tagName === "SPAN",
          };
        }),
      );
    const overlaps = (all: Awaited<ReturnType<typeof placed>>) =>
      all.flatMap((one, at) =>
        all
          .slice(at + 1)
          .filter(
            (other) =>
              one.box.left < other.box.right &&
              other.box.left < one.box.right &&
              one.box.top < other.box.bottom &&
              other.box.top < one.box.bottom,
          )
          .map((other) => `${one.text} on ${other.text}`),
      );

    await toStep(page, 2);
    // The marking step, then the cut step, the most crowded.
    for (const name of ["On the Workmate, in 3D", "In the Workmate, in 3D"]) {
      if (name.startsWith("In"))
        await page.getByRole("button", { name: "Done, next step" }).click();
      const picture = page.getByRole("figure", { name });
      await expect(picture).toBeVisible();
      // Placed once the picture's drawn.
      await expect.poll(async () => overlaps(await placed(picture))).toEqual([]);
      const marks = (await placed(picture)).filter((each) => each.mark);
      expect(marks.length).toBeGreaterThan(2);
      for (const mark of marks) expect(mark.size, mark.text).toBe(20);
    }
  });

  test("Reset view puts the camera back after a drag, and a drag can't take it under the floor or flat on top", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await toStep(page, 3);
    await expect(page.getByRole("figure", { name: "In the Workmate, in 3D" })).toBeVisible();

    // It opens where the step's scene says: from the side and above.
    await expect.poll(() => camera(page)).toEqual({ turn: -50, tilt: 30 });

    await drag(page, { x: 160, y: 0 });
    await expect.poll(async () => (await camera(page)).turn).not.toBe(-50);
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(() => camera(page)).toEqual({ turn: -50, tilt: 30 });

    // Dragged up as far as it goes, it stops above the floor; down, it stops short of the top.
    await drag(page, { x: 0, y: -400 });
    await expect.poll(async () => (await camera(page)).tilt).toBe(15);
    await drag(page, { x: 0, y: 400 });
    await drag(page, { x: 0, y: 400 });
    await expect.poll(async () => (await camera(page)).tilt).toBe(60);

    // Another step opens at its own angle: the end frame from above.
    await page.getByRole("button", { name: "Done, next step" }).click();
    await page.getByRole("button", { name: "Done, next step" }).click();
    await expect(
      page.getByRole("figure", { name: "One end frame, flat on the floor, in 3D" }),
    ).toBeVisible();
    await expect.poll(() => camera(page)).toEqual({ turn: -20, tilt: 60 });
  });
});

for (const [screen, viewport] of [
  ["unfolded", UNFOLDED],
  ["folded", FOLDED],
] as const) {
  test.describe(`the chat, ${screen}`, () => {
    test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

    test("an answer's table is a table, and nothing in the chat is cut off or scrolls sideways", async ({
      page,
    }) => {
      test.slow();
      await standInSpeechRecognition(page);
      await workspaceWithBuild(page);
      await openInFabrication(page);
      await page.setViewportSize(viewport);
      await chatSettled(page);

      // A tap on Hold to ask opens the chat to type in.
      await page.getByRole("button", { name: "Hold to ask" }).click();
      const chat = page.getByRole("dialog", { name: "Chat" });
      await expect(chat).toBeVisible();
      await chat
        .getByLabel("Message", { exact: true })
        .fill(
          [
            "The rack moves:",
            "",
            "| Was | Now |",
            "| --- | --- |",
            "| 120 cm off the floor | 150 cm off the floor, clear of the bench top |",
            "",
            `A long one: ${"workbench".repeat(12)}`,
          ].join("\n"),
        );
      await chat.getByRole("button", { name: "Send" }).click();

      const messages = chat.getByRole("list", { name: "Messages" });
      const table = messages.getByRole("table");
      await expect(table).toBeVisible({ timeout: 60_000 });
      await expect(table.getByRole("columnheader", { name: "Was" })).toBeVisible();
      await expect(table.getByRole("cell", { name: "120 cm off the floor" })).toBeVisible();

      // Every message sits inside the chat, and its column never scrolls sideways.
      const sheet = await boxOf(chat);
      for (const each of await messages.getByRole("listitem").all()) {
        const box = await boxOf(each);
        expect(box.x).toBeGreaterThanOrEqual(sheet.x);
        expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width + 1);
      }
      const column = messages.locator("xpath=..");
      expect(
        await column.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("folded", () => {
  test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

  test("it's At the bench alone, stacked: the step in 3D above, the step below, a swipe or Back and Done between them", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    // Folded, with the Build open.
    await page.setViewportSize(FOLDED);

    await expect(page.getByRole("group", { name: "Way of working" })).toHaveCount(0);
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(
      page.getByText("Swipe for the next step · open it on the Fold for Plan"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Hold to ask" })).toBeInViewport();
    expect(await overlappingLetters(page)).toEqual([]);
    const fills = await buildFills(page);
    expect(Math.max(fills.width, fills.height)).toBeGreaterThan(0.75);

    const steps = page.getByRole("region", { name: "Steps" });
    const done = page.getByRole("button", { name: "Done, next step" });
    for (let step = 1; step < 9; step += 1) await done.click();
    await expect(steps.getByRole("heading", { name: "Fit the shelf" })).toBeVisible();
    await expect(letter(page, "H, Shelf")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "G, Top")).toHaveCount(0);
    await expect(steps).toContainText("Fixings: 4 × 40 screws");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(steps.getByRole("heading", { name: "Fit the supports" })).toBeVisible();
    await expect(letter(page, "F, Top support")).toHaveAttribute("aria-current", "step");
    await swipe(steps, "left");
    await expect(steps.getByRole("heading", { name: "Fit the shelf" })).toBeVisible();
    await expect(done).toBeInViewport();
  });

  test("a printed part, folded: its step, with the part on its plate above it (#702)", async ({
    page,
  }) => {
    await holsterOpen(page);
    await page.setViewportSize(FOLDED);

    await expect(page.getByRole("region", { name: "In 3D" }).locator("canvas")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Steps" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hold to ask" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Done, next step" })).toBeInViewport();
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the three panels, as the desktop board has them", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);

    await expect(page.getByText("1500 × 600 × 900 mm · framed bench")).toBeVisible();
    for (const panel of ["Chat", "In 3D", "Cut plan"]) {
      await expect(page.getByRole("region", { name: panel })).toBeVisible();
    }
    await expect(page.getByRole("group", { name: "Way of working" })).toHaveCount(0);
  });

  test("its chat goes to the Build's session, and the answer comes back in it", async ({
    page,
  }) => {
    test.slow();
    await workspaceWithBuild(page);
    await openInFabrication(page);

    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat).toContainText("Started the Build");
    await chatSettled(page);
    await chat.getByLabel("Message", { exact: true }).fill("Do the washers come with them?");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByRole("list", { name: "Messages" })).toContainText(
      "You said: Do the washers come with them?",
    );
  });

  test("just the numbers, and a photo to check goes in the chat to send", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await page.getByRole("tab", { name: "Steps" }).click();
    const done = page.getByRole("button", { name: "Done, next step" });
    for (let step = 1; step < 5; step += 1) await done.click();
    const steps = page.getByRole("region", { name: "Steps" });
    const checklist = steps.getByRole("list", { name: "Checklist" });
    await expect(checklist).toContainText("Lay two legs (A) flat, 460 apart outside to outside.");

    await steps.getByRole("button", { name: "Just the numbers" }).click();
    await expect(checklist).toContainText("A × 2, 460 outside.");
    await expect(letter(page, "C, End rails")).toHaveAttribute("aria-current", "step");

    await steps.getByLabel("Photo to check").setInputFiles({
      name: "frames.png",
      mimeType: "image/png",
      // One grey pixel.
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat.getByLabel("Message", { exact: true })).toHaveValue(
      "Step 5, Make the two end frames: Both end frames, flat, from above. Measure corner to corner both ways. The same within 2 mm means it's square. Does it look right?",
    );
  });

  test("a printed part shows its size, and its file downloads, ready for Bambu Studio", async ({
    page,
  }) => {
    await holsterOpen(page);
    await expect(page.getByText("84.4 × 119.2 × 70.2 mm · printed part")).toBeVisible();
    for (const panel of ["Chat", "In 3D", "Print"]) {
      await expect(page.getByRole("region", { name: panel })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "In 3D" }).locator("canvas")).toHaveCount(1);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("link", { name: "Open in Bambu Studio" }).click();
    expect((await downloaded).suggestedFilename()).toBe("battery-holster.3mf");
  });

  test("a buy-list row opens its stock's options, and a pick changes the Build, with Undo", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await pickTheFrameTimber(page);
  });

  test("the bench stays as the owner turned it when the Build is asked for again", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    const bench = page.getByRole("region", { name: "In 3D" });
    const canvas = bench.locator("canvas");
    const letter = bench.getByRole("button", { name: "B, Long rails" });
    const placed = () => letter.evaluate((button) => button.style.transform);
    await expect.poll(placed).not.toBe("");
    const first = await placed();

    // Turned by a drag across it, from its corner, clear of the letters.
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("The bench isn't drawn.");
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 172, box.y + 12, { steps: 8 });
    await page.mouse.up();
    await expect.poll(placed).not.toBe(first);
    const turned = await placed();
    await canvas.evaluate((element) => element.setAttribute("data-first", ""));

    // Shown again, the page asks for the Build at once, as it does every 30 seconds.
    const asked = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/builds/split-bench"),
    );
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await asked;
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );

    await expect(bench.locator("canvas[data-first]")).toHaveCount(1);
    await expect(canvas).toHaveCount(1);
    expect(await placed()).toBe(turned);
  });
});

test("Fabrication is behind Courtyard's login", async ({ browser }) => {
  const away = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await away.newPage();
  await page.goto("/fabrication/workspaces/garage-gym/builds/workbench");
  await expect(page).toHaveURL(/\/login$/);
  await away.close();
});

test("Courtyard's service worker leaves Fabrication alone, keeping Courtyard's own page", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe("activated");
  await page.goto("/fabrication/");
  await expect(page.getByText("Open a Build from its project in Courtyard.")).toBeVisible();

  const kept = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const entry of await (await caches.open(name)).keys())
        urls.push(new URL(entry.url).pathname);
    }
    const appPage = await caches.match("/index.html");
    return { urls, appPage: appPage === undefined ? "" : await appPage.text() };
  });
  expect(kept.urls.filter((url) => url.startsWith("/fabrication"))).toEqual([]);
  expect(kept.appPage).not.toContain("<title>Fabrication</title>");
});
