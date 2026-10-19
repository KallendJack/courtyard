import { expect, type Locator, type Page, test } from "@playwright/test";
import { pngOf } from "../apps/worker/test/test-files.ts";
import { newWorkspace, startSaving } from "./saving.ts";
import { openTab, openWhatCourtyardKnows } from "./workspace-page.ts";

// A planning workspace's Home (#481; Paper, "Tablet · Home: the bike, parts pinned (#481)" and its
// Desktop and Cover boards): its current view, a Thing's photo with its parts pinned, the owner's
// last question above it and its next steps under it, Reply at the foot; its header's photo and
// pills (+ New · History · Things · Docs); and with nothing to show, the last conversation.

/** A tall photo, as a phone takes one: grey. */
const bikePhoto = () => ({
  name: "bike.png",
  mimeType: "image/png",
  buffer: Buffer.from(pngOf(60, 80, () => [120, 120, 120])),
});

/** Attaches a photo to the Reply box with its +. */
const attachPhoto = async (page: Page) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a photo or file" }).click();
  await (await chooser).setFiles([bikePhoto()]);
};

/**
 * A bike with a photo and three parts, as a model would add them: the chain to replace and the
 * rear tyre to pump up, both flagged; the fork fine, a faint dot. The answer suggests two next
 * steps. Back on Home after.
 */
const addBike = async (page: Page, name: string) => {
  await attachPhoto(page);
  await startSaving(
    page,
    [
      "thing add: name Whyte T-140 | status have | brand Whyte | photo 1",
      "thing add: name Chain | status replace | part of T1 | pin 50, 50 | needs Replace: it's stretched | brand KMC X11",
      "thing add: name Rear tyre | status have | part of T1 | pin 80, 60 | needs Pump it up before Saturday",
      "thing add: name Fork | status have | part of T1 | pin 20, 30",
      "suggest replies: Find a chain under £30 | Which lights?",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Things saved" }).getByRole("listitem")).toHaveCount(
    4,
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
};

const view = (page: Page) => page.getByRole("region", { name: "Whyte T-140" });

/** Where a pin's middle is on the page. */
const middleOf = async (pin: Locator) => {
  const box = await pin.boundingBox();
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
};

test("a new workspace's Home is only its name, one line and the message box", async ({ page }) => {
  const name = `Shed ${Date.now()}`;
  await newWorkspace(page, name);

  await expect(page.getByText("Tell Courtyard about this, by voice or photo")).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace tabs" })).toHaveCount(0);
  // With no photo yet, the header's ring is the workspace's icon, which offers one.
  await expect(page.getByRole("button", { name: `Add a photo of ${name}` })).toBeVisible();
});

test("Home shows the bike's photo with what needs doing pinned, the last question and its next steps", async ({
  page,
}) => {
  const name = `Bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  // The header: the workspace's photo, and the pills.
  await expect(page.getByRole("link", { name: "Whyte T-140's card" })).toBeVisible();
  const pills = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(pills.getByRole("button", { name: "+ New" })).toBeVisible();
  await expect(pills.getByRole("link")).toHaveText(["History1", "Things4"]);

  // The view: the flagged parts numbered in gold, the fine one a faint dot; only what needs doing.
  const bike = view(page);
  await expect(bike.getByRole("img", { name: "Photo of Whyte T-140" })).toBeVisible();
  await expect(bike.getByRole("button", { name: "1: Chain" })).toBeVisible();
  await expect(bike.getByRole("button", { name: "2: Rear tyre" })).toBeVisible();
  await expect(bike.getByRole("button", { name: "Fork", exact: true })).toBeVisible();
  const parts = bike.getByRole("list", { name: "What needs doing" });
  await expect(parts.getByRole("listitem")).toHaveText([
    "1ChainReplace: it's stretched",
    "2Rear tyrePump it up before Saturday",
  ]);
  await expect(bike).not.toContainText("KMC X11");

  // The last question above it, the next steps under it, and Reply at the foot.
  await expect(page.getByRole("link", { name: /^Your last question: thing add/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Next steps" }).getByRole("button")).toHaveText([
    "Find a chain under £30",
    "Which lights?",
  ]);
  await expect(page.getByLabel("Message", { exact: true })).toHaveAttribute(
    "placeholder",
    "Reply…",
  );

  // What Courtyard knows is in the ⋯ now.
  await openWhatCourtyardKnows(page);
  await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();
});

test("a tap on a pin opens its part's card, whose Done it takes it off what needs doing", async ({
  page,
}) => {
  const name = `Bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  await view(page).getByRole("button", { name: "2: Rear tyre" }).click();
  const card = page.getByRole("region", { name: "Rear tyre's card" });
  await expect(card).toContainText("Pump it up before Saturday");
  await card.getByRole("button", { name: "Done it" }).click();

  await expect(card).toHaveCount(0);
  await expect(view(page).getByRole("button", { name: "Rear tyre", exact: true })).toBeVisible();
  await expect(
    view(page).getByRole("list", { name: "What needs doing" }).getByRole("listitem"),
  ).toHaveCount(1);
});

test("dragging a pin moves it, and it stays where it was put", async ({ page }) => {
  const name = `Bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  const fork = view(page).getByRole("button", { name: "Fork", exact: true });
  const from = await middleOf(fork);
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
  const moved = await middleOf(view(page).getByRole("button", { name: "Fork", exact: true }));
  expect(Math.abs(moved.x - (from.x + 30))).toBeLessThan(4);
  expect(Math.abs(moved.y - (from.y + 40))).toBeLessThan(4);
});

test("a next step replies in the last question's session, and + New starts another", async ({
  page,
}) => {
  const name = `Bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  await page
    .getByRole("list", { name: "Next steps" })
    .getByRole("button", { name: "Which lights?" })
    .click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Which lights?");
  await expect(session).toContainText("You said: thing add");

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(
    page.getByRole("link", { name: /^Your last question: Which lights\?/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ New" }).click();
  const box = page.getByLabel("Message", { exact: true });
  await expect(box).toBeFocused();
  await box.fill("Where do I ride this weekend?");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).not.toContainText("Which lights?");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "History");
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(2);
});

test("with two pictures, the switch chips pick one, and the pick sticks", async ({ page }) => {
  const name = `Bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);
  await page.getByRole("button", { name: "+ New" }).click();
  await attachPhoto(page);
  await startSaving(
    page,
    // The bike's four Things are T1 to T4, so the road bike is T5.
    "thing add: name Road bike | status have | photo 1\nthing add: name Saddle | status want | part of T5 | pin 40, 20",
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

test("the tabs appear as the workspace fills, and the chosen one goes back to Home", async ({
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
  // Nothing to picture yet: Home is the last conversation and the Reply box.
  await expect(page.getByRole("link", { name: /^Your last question: thing add/ })).toBeVisible();

  await openTab(page, "Things");
  await expect(page.getByRole("region", { name: "Things" })).toContainText("Shelving");
  await openTab(page, "Docs");
  await expect(page.getByRole("region", { name: "Documents" })).toContainText("Shelf sizes");
  await openTab(page, "History");
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(1);
  await openTab(page, "Home");
  await expect(page.getByRole("link", { name: /^Your last question: / })).toBeVisible();
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

  test("a pin moves only once held; a quick tap opens its card", async ({ page }) => {
    const name = `Bikes ${Date.now()}`;
    await newWorkspace(page, name);
    await addBike(page, name);
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();

    const fork = () => view(page).getByRole("button", { name: "Fork", exact: true });
    // A finger sliding over it at once is a scroll: the pin stays.
    const before = await touchDrag(fork(), { x: 30, y: 30 }, 0);
    expect(await middleOf(fork())).toEqual(before);
    // Held, then dragged, it moves.
    await touchDrag(fork(), { x: 30, y: 30 }, 700);
    await expect.poll(async () => (await middleOf(fork())).x).toBeGreaterThan(before.x + 20);

    // A quick tap opens its card, over the page.
    await view(page).getByRole("button", { name: "1: Chain" }).tap();
    await expect(page.getByRole("dialog", { name: "Chain" })).toContainText(
      "Replace: it's stretched",
    );
  });
});
