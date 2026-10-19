import { expect, type Locator, type Page, test } from "@playwright/test";
import { pngOf } from "../apps/worker/test/test-files.ts";
import { newWorkspace, startSaving } from "./saving.ts";
import { openTab, openWhatCourtyardKnows } from "./workspace-page.ts";

// A planning workspace's Home (#565; Paper, "Tablet · Planning Home: the bike, part by part
// (#565)" and its Desktop and Cover boards): a view of the workspace's main subject and nothing
// else, a Thing's photo with every part labelled, a tap on one opening its card at the view's
// foot; no chat, the next steps in History; its header's photo and pills (+ New · History ·
// Things · Docs); and with nothing to show, one quiet line.

// Its workspaces sort after the Garage gym fixture: Settings' Get to know me starts its session in
// the first planning workspace, and that would become this Home's latest session.

/** A tall photo, as a phone takes one: grey. */
const bikePhoto = () => ({
  name: "bike.png",
  mimeType: "image/png",
  buffer: Buffer.from(pngOf(60, 80, () => [120, 120, 120])),
});

/** Attaches a photo to the message box with its +. */
const attachPhoto = async (page: Page) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a photo or file" }).click();
  await (await chooser).setFiles([bikePhoto()]);
};

/**
 * A bike with a photo and four parts, as a model would add them: the chain to replace and the
 * rear tyre to pump up, both flagged; the fork fine; the saddle not placed on the photo yet. The
 * answer suggests two next steps. Back on Home after.
 */
const addBike = async (page: Page, name: string) => {
  await attachPhoto(page);
  await startSaving(
    page,
    [
      "thing add: name Whyte T-140 | status have | brand Whyte | photo 1",
      "thing add: name Chain | status replace | part of T1 | pin 50, 50 | needs Replace: it's stretched | brand KMC X11",
      "thing add: name Rear tyre | status have | part of T1 | pin 80, 60 | needs Pump it up before Saturday",
      "thing add: name Fork | status have | part of T1 | pin 20, 30 | brand RockShox | size 120 mm",
      "thing add: name Saddle | status have | part of T1",
      "suggest replies: Find a chain under £30 | Which lights?",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Things saved" }).getByRole("listitem")).toHaveCount(
    5,
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
};

const view = (page: Page) => page.getByRole("region", { name: "Whyte T-140" });
/** A part's label: beside the photo once it's placed, under it until then. */
const label = (page: Page, part: string) =>
  view(page).getByRole("button", { name: part, exact: true });
const pin = (page: Page, part: string) =>
  view(page).getByRole("button", { name: `Pin: ${part}`, exact: true });
const messageBox = (page: Page) => page.getByLabel("Message", { exact: true });

/** Where a pin's middle is on the page. */
const middleOf = async (pin: Locator) => {
  const box = await pin.boundingBox();
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
};

test("a new workspace's Home is only its name, one line and the message box", async ({ page }) => {
  const name = `Shed ${Date.now()}`;
  await newWorkspace(page, name);

  await expect(page.getByText("Tell Courtyard about this, by voice or photo")).toBeVisible();
  await expect(messageBox(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace tabs" })).toHaveCount(0);
  // With no photo yet, the header's ring is the workspace's icon, which offers one.
  await expect(page.getByRole("button", { name: `Add a photo of ${name}` })).toBeVisible();
});

test("Home breaks the bike down on its photo, every part labelled, with no chat", async ({
  page,
}) => {
  const name = `Road bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  // The header: the workspace's photo, and the pills.
  await expect(page.getByRole("link", { name: "Whyte T-140's card" })).toBeVisible();
  const pills = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(pills.getByRole("button", { name: "+ New" })).toBeVisible();
  await expect(pills.getByRole("link")).toHaveText(["History1", "Things5"]);

  // The view: every part labelled, not only those that need something; a pin for each placed one.
  const bike = view(page);
  await expect(bike.getByRole("img", { name: "Photo of Whyte T-140" })).toBeVisible();
  for (const part of ["Chain", "Rear tyre", "Fork", "Saddle"]) {
    await expect(label(page, part)).toBeVisible();
  }
  for (const part of ["Chain", "Rear tyre", "Fork"]) await expect(pin(page, part)).toBeVisible();
  await expect(pin(page, "Saddle")).toHaveCount(0);
  // Calm: what a part needs waits in its card, and its details too.
  await expect(bike).not.toContainText("Pump it up before Saturday");
  await expect(bike).not.toContainText("KMC X11");

  // No chat: no last question, no next steps, and the box out of sight until it's asked for.
  await expect(page.getByRole("link", { name: /^Your last question/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Next steps" })).toHaveCount(0);
  await expect(messageBox(page)).toBeHidden();

  // What Courtyard knows is in the ⋯.
  await openWhatCourtyardKnows(page);
  await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
});

test("a tap on a part opens its card at the view's foot: what's fitted, what it needs, Done it and Ask about it", async ({
  page,
}) => {
  const name = `Road bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  // From its pin: what's fitted.
  await pin(page, "Fork").click();
  const fork = view(page).getByRole("region", { name: "Fork's card" });
  await expect(fork).toContainText("RockShox · 120 mm");
  await expect(label(page, "Fork")).toHaveAttribute("aria-pressed", "true");

  // From its label: what it needs, and Done it.
  await label(page, "Rear tyre").click();
  const tyre = view(page).getByRole("region", { name: "Rear tyre's card" });
  await expect(tyre).toContainText("Pump it up before Saturday");
  await expect(fork).toHaveCount(0);
  await tyre.getByRole("button", { name: "Done it" }).click();
  await expect(tyre).not.toContainText("Pump it up before Saturday");
  await expect(tyre.getByRole("button", { name: "Done it" })).toHaveCount(0);

  // Ask about it opens the box for a new session about the part.
  await tyre.getByRole("button", { name: "Ask about it" }).click();
  await expect(messageBox(page)).toBeVisible();
  await expect(messageBox(page)).toHaveValue("About the Rear tyre on the Whyte T-140: ");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});

test("dragging a pin moves it, and it stays where it was put", async ({ page }) => {
  const name = `Road bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  // Hovering waits for the pin to be still: the page settles once the frame has measured it.
  await pin(page, "Fork").hover();
  const from = await middleOf(pin(page, "Fork"));
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/pin") && response.request().method() === "PUT",
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 40, { steps: 5 });
  await page.mouse.up();
  // A drag isn't a tap: no card opens.
  await expect(page.getByRole("region", { name: "Fork's card" })).toHaveCount(0);
  expect((await saved).ok()).toBe(true);

  await page.reload();
  const moved = await middleOf(pin(page, "Fork"));
  expect(Math.abs(moved.x - (from.x + 30))).toBeLessThan(4);
  expect(Math.abs(moved.y - (from.y + 40))).toBeLessThan(4);
});

test("a part with no pin is placed with a tap on it, then on the photo, and stays", async ({
  page,
}) => {
  const name = `Road bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  await label(page, "Saddle").click();
  await expect(view(page)).toContainText("Tap the photo where the Saddle is");
  const photo = await view(page).getByRole("img", { name: "Photo of Whyte T-140" }).boundingBox();
  const at = {
    x: (photo?.x ?? 0) + (photo?.width ?? 0) * 0.4,
    y: (photo?.y ?? 0) + (photo?.height ?? 0) * 0.3,
  };
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/pin") && response.request().method() === "PUT",
  );
  await page.mouse.click(at.x, at.y);
  expect((await saved).ok()).toBe(true);
  await expect(pin(page, "Saddle")).toBeVisible();
  await expect(view(page)).not.toContainText("Tap the photo where the Saddle is");

  await page.reload();
  const placed = await middleOf(pin(page, "Saddle"));
  expect(Math.abs(placed.x - at.x)).toBeLessThan(4);
  expect(Math.abs(placed.y - at.y)).toBeLessThan(4);
});

test("History's latest session shows its next steps, one replying in it, and + New starts another", async ({
  page,
}) => {
  const name = `Road bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  await openTab(page, "History");
  const sessions = page.getByRole("region", { name: "Sessions" });
  await sessions
    .getByRole("list", { name: "Next steps" })
    .getByRole("button", { name: "Which lights?" })
    .click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Which lights?");
  await expect(session).toContainText("You said: thing add");

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page.getByRole("button", { name: "+ New" }).click();
  const box = messageBox(page);
  await expect(box).toBeFocused();
  await box.fill("Where do I ride this weekend?");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).not.toContainText("Which lights?");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "History");
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(2);
});

test("with two Things broken down, the switch chips pick one, and the pick sticks", async ({
  page,
}) => {
  const name = `Road bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);
  await page.getByRole("button", { name: "+ New" }).click();
  await attachPhoto(page);
  await startSaving(
    page,
    // The bike's five Things are T1 to T5, so the road bike is T6.
    "thing add: name Road bike | status have | photo 1\nthing add: name Bar tape | status want | part of T6 | pin 40, 20",
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  // The road bike changed last, so it shows; the chip picks the other.
  const chips = page.getByRole("group", { name: "Views" });
  await expect(chips.getByRole("radio", { name: "Road bike" })).toBeChecked();
  await chips.getByText("Whyte T-140").click();
  await expect(view(page)).toBeVisible();
  await page.reload();
  await expect(view(page)).toBeVisible();
  await expect(chips.getByRole("radio", { name: "Whyte T-140" })).toBeChecked();
});

test("the tabs appear as the workspace fills, and Home with nothing to break down is one quiet line", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    [
      "thing add: name Shelving | status want",
      "save document",
      "# Shelf sizes",
      "",
      "The back wall is 2.4 m.",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Things saved" })).toContainText("Shelving");
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(tabs.getByRole("link")).toHaveText(["History1", "Things1", "Docs1"]);
  const quiet = page.getByText("A Thing with a photo and parts shows here, part by part.");
  await expect(quiet).toBeVisible();
  await expect(page.getByRole("link", { name: /^Your last question/ })).toHaveCount(0);

  await openTab(page, "Things");
  await expect(page.getByRole("region", { name: "Things" })).toContainText("Shelving");
  await openTab(page, "Docs");
  await expect(page.getByRole("region", { name: "Documents" })).toContainText("Shelf sizes");
  await openTab(page, "History");
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(1);
  await openTab(page, "Home");
  await expect(quiet).toBeVisible();
});

test("What Courtyard knows holds the facts, plans and ideas, and a line is fixed by starting a session on it", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await openWhatCourtyardKnows(page);

  await expect(page.getByRole("region", { name: "Facts" })).toContainText("up-and-over door");
  await expect(page.getByRole("region", { name: "Plans" })).toContainText("squat rack");
  await expect(page.getByRole("region", { name: "Ideas" })).toContainText("Rubber flooring");
  await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();

  // A tap on a line shows the session it starts, all of it, before a second tap starts it.
  await page.getByRole("button", { name: "Fix: Rubber flooring." }).click();
  const fixing = page.getByRole("group", { name: "Fix this line" });
  await expect(fixing).toContainText('Starts a session: "This line is wrong: Rubber flooring."');
  await fixing.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: This line is wrong: Rubber flooring.",
  );
});

test.describe("on the unfolded Fold", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  /** A finger on a pin: pressed, then moved by `by`, after holding it `heldMs`. */
  const touchDrag = async (pin: Locator, by: { x: number; y: number }, heldMs: number) => {
    const from = await middleOf(pin);
    const at = (x: number, y: number) => ({
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: x,
      clientY: y,
      bubbles: true,
    });
    await pin.dispatchEvent("pointerdown", at(from.x, from.y));
    await pin.page().waitForTimeout(heldMs);
    await pin.dispatchEvent("pointermove", at(from.x + by.x / 2, from.y + by.y / 2));
    await pin.dispatchEvent("pointermove", at(from.x + by.x, from.y + by.y));
    await pin.dispatchEvent("pointerup", at(from.x + by.x, from.y + by.y));
    return from;
  };

  test("a pin moves only once held; a quick tap opens its card; the box waits for Talk or + New", async ({
    page,
  }) => {
    const name = `Road bikes ${Date.now()}`;
    await newWorkspace(page, name);
    await addBike(page, name);
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
    await expect(messageBox(page)).toBeHidden();

    const fork = () => pin(page, "Fork");
    // A finger sliding over it at once is a scroll: the pin stays.
    const before = await touchDrag(fork(), { x: 30, y: 30 }, 0);
    expect(await middleOf(fork())).toEqual(before);
    // Held, then dragged, it moves.
    await touchDrag(fork(), { x: 30, y: 30 }, 700);
    await expect.poll(async () => (await middleOf(fork())).x).toBeGreaterThan(before.x + 20);

    // A quick tap opens its card, at the view's foot.
    await pin(page, "Chain").tap();
    await expect(view(page).getByRole("region", { name: "Chain's card" })).toContainText(
      "Replace: it's stretched",
    );

    // + New opens the box, to start a session.
    await page.getByRole("button", { name: "+ New" }).tap();
    await expect(messageBox(page)).toBeVisible();
  });
});
