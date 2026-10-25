import { expect, type Page, test } from "@playwright/test";
import { BuildOpened } from "../packages/contract/index.ts";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { goldenHolster } from "../packages/fabrication/print/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";

// Fabrication (#698, ADR 0036; Paper, 2 · Agreed, "Fabrication · A Build · Tablet (#698)",
// "· Desktop 1440×900 (#698)" and "· A Build, buy list · Cover (#698)"): a project step's Build
// opens in Fabrication, served under /fabrication behind Courtyard's login, with its 3D view, cut
// plan, buy list and a chat in its session. The worker's side is in fabrication-chat.test.ts.

const STEP = "Build the workbench";

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

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("a step's Build opens in Fabrication: in 3D, its cut plan, buy list, and a part's card", async ({
    page,
  }) => {
    const name = await workspaceWithBuild(page);
    await openInFabrication(page);

    // The top bar: back to its project, its size, and what the making rules found.
    await expect(
      page.getByRole("link", { name: `Back to ${name} · Split the garage` }),
    ).toBeVisible();
    await expect(page.getByText("1500 × 600 × 900 mm · framed bench")).toBeVisible();
    await expect(page.getByRole("button", { name: "2 to check" })).toBeVisible();
    const toCheck = page.getByRole("list", { name: "To check" });
    await expect(toCheck).toContainText("M6 × 50 bolts too short");
    await expect(toCheck).toContainText(
      "Support for the long end, Spanner, Countersink bit and Spirit level not to hand",
    );

    // Three panels: the chat, the bench in 3D, and the cut plan.
    await expect(page.getByRole("region", { name: "Chat" })).toContainText("Started the Build");
    const bench = page.getByRole("region", { name: "In 3D" });
    await expect(bench.getByRole("heading", { name: "The bench" })).toBeVisible();
    const cutPlan = page.getByRole("region", { name: "Cut plan" });
    await expect(cutPlan).toContainText("Each saw cut takes 3 mm · assumed");
    await expect(cutPlan.getByRole("button", { name: "B, 1450 mm" })).toHaveCount(1);
    await expect(cutPlan).toContainText("45 × 95 C16, 2.4 m× 4");

    // A part tapped in the key lights it in the cut plan too, and opens its card.
    await bench
      .getByRole("list", { name: "Parts" })
      .getByRole("button", { name: "B Long rails" })
      .click();
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

    // The buy list, with its total.
    await page.getByRole("tab", { name: "Buy list" }).click();
    const buyList = page.getByRole("region", { name: "Buy list" });
    await expect(buyList).toContainText("To buy · 11");
    await expect(buyList.getByRole("link", { name: /Wheelwright TD60 castors/ })).toHaveAttribute(
      "href",
      "https://shop.example/td60",
    );
    await expect(buyList).toContainText("Total £177.02");

    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByRole("region", { name: "Tools" })).toContainText("4 not to hand");
  });

  test("a printed part shows on the plate with its size, its sources and its file (#702)", async ({
    page,
  }) => {
    await holsterOpen(page);

    await expect(page.getByText("84.4 × 119.2 × 70.2 mm · printed part")).toBeVisible();
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
      "Steps",
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
    await expect(
      print.getByRole("button", { name: "Send to printer · once you have one" }),
    ).toBeDisabled();

    await page.getByRole("tab", { name: "Buy list" }).click();
    await expect(page.getByRole("region", { name: "Buy list" })).toContainText(
      "4 × 30 mm wood screws",
    );
  });

  test("a buy-list row opens its stock's options, and a pick changes the Build, with Undo", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await pickTheFrameTimber(page);
  });

  test("its chat goes to the Build's session, and the answer comes back in it", async ({
    page,
  }) => {
    // The fake echoes the Build's parameters a word at a time before it's free.
    test.slow();
    await workspaceWithBuild(page);
    await openInFabrication(page);

    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat).toContainText("Started the Build");
    await expect(chat.getByText("Answering…")).toBeHidden({ timeout: 90_000 });
    await chat.getByLabel("Message", { exact: true }).fill("Do the washers come with them?");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByRole("list", { name: "Messages" })).toContainText(
      "You said: Do the washers come with them?",
    );
  });
});

// The instruction manual (#699; Paper, 2 · Agreed, "Fabrication · Build steps v2, teaching ·
// Tablet (#699)", "· Build steps, cutting by your tools · Tablet (#699)" and "· Build steps ·
// Cover (#699)"): one step at a time, the 3D view built up to it.

/** The 3D panel's letter for a part, as the bench at a step shows it. */
const letter = (page: Page, name: string) =>
  page.getByRole("region", { name: "In 3D" }).getByRole("button", { name, exact: true });

test.describe("the steps, on the unfolded Fold", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("stepping through shows each step's parts, tools and fixings, and the 3D view builds up to it", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await page.getByRole("tab", { name: "Steps" }).click();
    const steps = page.getByRole("region", { name: "Steps" });
    const done = page.getByRole("button", { name: "Done, next step" });

    // Nothing's put on yet: the whole bench shows.
    await expect(steps).toContainText("Step 1 of 12 · about 10 min");
    await expect(steps.getByRole("heading", { name: "Check what's arrived" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(letter(page, "G, Top")).toBeVisible();

    // Cutting goes by the tools to hand: the hand saw, the circular saw not yet.
    await done.click();
    await done.click();
    await expect(steps.getByRole("heading", { name: "Cut and label the timber" })).toBeVisible();
    const ways = steps.getByRole("region", { name: "How you'll do it" });
    await expect(ways.getByRole("listitem")).toHaveText(["Hand saw", "Circular saw · not yet"]);
    // As the board has it: something to rest the long end on, to check.
    const cutTools = steps.getByRole("region", { name: "Tools for this step" });
    await cutTools.getByRole("button", { name: /tools ready/ }).click();
    await expect(cutTools).toContainText("Support for the long end? Check");
    await cutTools.getByRole("button", { name: /tools ready/ }).click();

    // The castors: the bases alone in 3D, lit; the spanner to check; the bolts at the length to
    // use, with why in gold.
    await done.click();
    await expect(
      steps.getByRole("heading", { name: "Fit the castors to the bases" }),
    ).toBeVisible();
    await expect(letter(page, "E, Castor bases")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "A, Legs")).toHaveCount(0);
    await expect(steps).toContainText(
      "Fixings: M6 × 60 bolts (16), M6 washers (32) and M6 lock nuts (16)",
    );
    const found = steps.getByRole("list", { name: "To check in this step" });
    await expect(found).toContainText("M6 × 50 bolts too short");
    await expect(found).toContainText("The steps and buy list use ones 60 mm long.");
    const tools = steps.getByRole("region", { name: "Tools for this step" });
    await tools.getByRole("button", { name: /tools ready/ }).click();
    await expect(tools).toContainText("Spanner? Check");
    await expect(tools).toContainText("Drill driver");

    // The end frames: lit, on top of the bases now faint; a checklist with words to tap.
    await done.click();
    await expect(steps.getByRole("heading", { name: "Make the two end frames" })).toBeVisible();
    await expect(page.getByRole("region", { name: "In 3D" })).toContainText(
      "Step 5 · Make the two end frames",
    );
    await expect(letter(page, "A, Legs")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "C, End rails")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "E, Castor bases")).not.toHaveAttribute("aria-current", "step");
    await expect(letter(page, "B, Long rails")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Close-up" })).toContainText(
      "Close-up · One end frame",
    );
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
});

test.describe("the steps, on the cover screen", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("a step is chosen from the strip, and the 3D view moves to it", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    // Folded, with the Build open.
    await page.setViewportSize({ width: 476, height: 695 });
    await page.getByRole("tablist", { name: "Show" }).getByRole("tab", { name: "Steps" }).click();

    await page.getByRole("button", { name: "Step 9, Fit the shelf" }).click();
    const steps = page.getByRole("region", { name: "Steps" });
    await expect(steps.getByRole("heading", { name: "Fit the shelf" })).toBeVisible();
    await expect(letter(page, "H, Shelf")).toHaveAttribute("aria-current", "step");
    await expect(letter(page, "G, Top")).toHaveCount(0);
    await expect(steps).toContainText("Fixings: 4 × 40 screws");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(steps.getByRole("heading", { name: "Fit the supports" })).toBeVisible();
    await expect(letter(page, "F, Top support")).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Done, next step" })).toBeInViewport();
  });
});

test.describe("the steps, on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("just the numbers, and a photo to check goes in the chat to send", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    await page.getByRole("tab", { name: "Steps" }).click();
    await page.getByRole("button", { name: "Step 5, Make the two end frames" }).click();
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
});

test.describe("on the cover screen", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("the panels are tabs", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    // Folded, with the Build open.
    await page.setViewportSize({ width: 476, height: 695 });

    const tabs = page.getByRole("tablist", { name: "Show" });
    await expect(tabs.getByRole("tab")).toHaveText([
      "Bench",
      "Chat",
      "Cut plan",
      "Buy list",
      "Tools",
      "Steps",
    ]);
    await expect(page.getByRole("region", { name: "In 3D" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cut plan" })).toBeHidden();

    await tabs.getByRole("tab", { name: "Buy list" }).click();
    await expect(page.getByRole("region", { name: "Buy list" })).toContainText("Total £177.02");
    await tabs.getByRole("tab", { name: "Chat" }).click();
    await expect(page.getByRole("region", { name: "Chat" })).toContainText("Started the Build");
  });

  test("a printed part's panels are tabs too: the part first, then its Print tab", async ({
    page,
  }) => {
    await holsterOpen(page);
    await page.setViewportSize({ width: 476, height: 695 });

    const tabs = page.getByRole("tablist", { name: "Show" });
    await expect(tabs.getByRole("tab")).toHaveText(["Part", "Chat", "Print", "Buy list", "Steps"]);
    await expect(page.getByRole("region", { name: "In 3D" }).locator("canvas")).toHaveCount(1);
    await tabs.getByRole("tab", { name: "Print" }).click();
    await expect(page.getByRole("region", { name: "Print" })).toContainText(
      "battery-holster.3mfready",
    );
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the three panels, as the desktop board has them", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);

    for (const panel of ["Chat", "In 3D", "Cut plan"]) {
      await expect(page.getByRole("region", { name: panel })).toBeVisible();
    }
  });

  test("a printed part's file downloads, ready for Bambu Studio", async ({ page }) => {
    await holsterOpen(page);
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
