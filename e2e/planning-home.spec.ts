import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openTab, openWhatCourtyardKnows } from "./workspace-page.ts";

// A planning workspace's Home (#603; Paper, "Tablet · Mountain biking Home: the bike, then
// projects (#603)"): its main subject, the drawn bike with each part placed on it by name, a
// label each that opens its card, one with an upcoming replacement saying so, and those it has no
// place for listed under it; then its projects (projects.spec.ts), then the message box. Its
// header is the name and the pills (+ New · History · Things · Docs); no photo, no view chips, no
// next steps. With nothing to show, one quiet line.

// Its workspaces sort after the Garage gym fixture: Settings' Get to know me starts its session in
// the first planning workspace, and that would become this Home's latest session.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/**
 * The hardtail and its parts as the owner named them, as a model would add them: new pedals
 * picked for the pedals, and a bottle cage the drawing has no place for, then any `more` lines (its
 * projects). Back on Home after.
 */
const addBike = async (page: Page, name: string, more: readonly string[] = []) => {
  const part = (named: string, more = "") =>
    `thing add: name ${named} | status have | part of T1${more}`;
  await startSaving(
    page,
    [
      "thing add: name Boardman MHT 8.6 | status have | brand Boardman",
      part("Saddle"),
      part("Grips"),
      part("Fork", " | brand RockShox | size 120 mm"),
      part("Brakes"),
      part("Drivetrain"),
      part("Pedals", " | upcoming DMR V8 | upcoming price £60"),
      part("Front tyre"),
      part("Rear tyre"),
      part("Bottle cage"),
      ...more,
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Things saved" }).getByRole("listitem")).toHaveCount(
    10,
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
};

const bike = (page: Page) => page.getByRole("region", { name: "Boardman MHT 8.6" });
const label = (page: Page, words: string) =>
  bike(page).getByRole("link", { name: words, exact: true });
const messageBox = (page: Page) => page.getByLabel("Message", { exact: true });

test("a new workspace's Home is only its name, one line and the message box", async ({ page }) => {
  const name = `Shed ${Date.now()}`;
  await newWorkspace(page, name);

  await expect(page.getByText("Tell Courtyard about this, by voice or photo")).toBeVisible();
  await expect(messageBox(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace tabs" })).toHaveCount(0);
  // No photo in the header any more (#603).
  await expect(page.getByRole("button", { name: `Add a photo of ${name}` })).toHaveCount(0);
});

test.describe("on the unfolded Fold", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("Home leads with the drawn bike, each part on it by name, the upcoming one said, the rest under it, and the box", async ({
    page,
  }) => {
    const name = `Trail bike ${Date.now()}`;
    await newWorkspace(page, name);
    await addBike(page, name);

    // The header: the name and the pills, no photo.
    const pills = page.getByRole("navigation", { name: "Workspace tabs" });
    await expect(pills.getByRole("button", { name: "+ New" })).toBeVisible();
    await expect(pills.getByRole("link")).toHaveText(["History1", "Things10"]);
    await expect(page.getByRole("link", { name: /'s card$/ })).toHaveCount(0);

    // The drawing, not the photo, with every part that has a place on it labelled.
    await expect(
      bike(page).getByRole("img", { name: "Drawing of Boardman MHT 8.6" }),
    ).toBeVisible();
    for (const part of [
      "Saddle",
      "Grips",
      "Fork",
      "Brakes",
      "Drivetrain",
      "Front tyre",
      "Rear tyre",
    ]) {
      await expect(label(page, part)).toBeVisible();
    }
    await expect(label(page, "Pedals · DMR V8 next")).toBeVisible();
    // Calm: details wait on the part's card.
    await expect(bike(page)).not.toContainText("RockShox");
    // A part it has no place for is listed under it.
    await expect(bike(page).getByRole("list", { name: "Parts" })).toHaveText(["Bottle cage"]);

    // No view chips, no next steps, and the box that starts a session is there, under it all.
    await expect(page.getByRole("group", { name: "Views" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Next steps" })).toHaveCount(0);
    await expect(messageBox(page)).toBeVisible();
    await expect(messageBox(page)).toHaveAttribute(
      "placeholder",
      "Talk or type to start a session…",
    );
    await shot(page, "planning-home-drawn-bike");

    // A label opens the part's card.
    await label(page, "Pedals · DMR V8 next").tap();
    await expect(page.getByRole("heading", { level: 1, name: "Pedals" })).toBeVisible();
    await page.goBack();
    await bike(page).getByRole("list", { name: "Parts" }).getByRole("link").tap();
    await expect(page.getByRole("heading", { level: 1, name: "Bottle cage" })).toBeVisible();
  });

  test("the drawing never runs past its panel, and a label points at its place", async ({
    page,
  }) => {
    const name = `Trail bike ${Date.now()}`;
    await newWorkspace(page, name);
    await addBike(page, name);

    const panel = await bike(page).boundingBox();
    const drawing = await bike(page).getByRole("img").boundingBox();
    expect(drawing).not.toBeNull();
    expect(panel).not.toBeNull();
    if (drawing === null || panel === null) return;
    expect(drawing.y).toBeGreaterThanOrEqual(panel.y - 1);
    expect(drawing.y + drawing.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    // The drawing keeps its shape.
    expect(drawing.width / drawing.height).toBeCloseTo(622 / 300, 1);
    // The saddle's label is up and left of the pedals' one, as the drawing places them.
    const saddle = await label(page, "Saddle").boundingBox();
    const pedals = await label(page, "Pedals · DMR V8 next").boundingBox();
    expect((saddle?.y ?? 0) < (pedals?.y ?? 0)).toBe(true);
    expect((saddle?.x ?? 0) < (pedals?.x ?? 0)).toBe(true);
  });
});

// The owner's Fold, its browser's bars in (950×662) and not (950×712), and a shorter panel: with
// the projects under it the bike is drawn small, and its labels still never overlap (#657).
for (const viewport of [
  { width: 950, height: 662 },
  { width: 950, height: 712 },
  { width: 950, height: 560 },
]) {
  test.describe(`at ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test("with projects under the bike, no two labels overlap and each stays in the panel", async ({
      page,
    }) => {
      const name = `Trail bike ${Date.now()}`;
      await newWorkspace(page, name);
      const project = (named: string, step: string) =>
        `project: ${JSON.stringify({ name: named, add_steps: [{ kind: "you can do this", text: step }] })}`;
      await addBike(page, name, [
        project("Ride red trails with confidence", "The cornering drill on Saturday's ride"),
        project("Bike set up right", "Fit the DMR V8 pedals when they arrive"),
      ]);
      await expect(
        page.getByRole("region", { name: "Projects" }).getByRole("listitem"),
      ).toHaveCount(2);
      await expect(label(page, "Pedals · DMR V8 next")).toBeVisible();

      const panel = await bike(page).boundingBox();
      expect(panel).not.toBeNull();
      if (panel === null) return;
      const boxes = await bike(page)
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => {
            const { left, top, right, bottom } = link.getBoundingClientRect();
            return { name: link.textContent ?? "", left, top, right, bottom };
          }),
        );
      expect(boxes).toHaveLength(9);
      for (const box of boxes) {
        expect(box.left, `${box.name} inside the panel`).toBeGreaterThanOrEqual(panel.x - 1);
        expect(box.right, `${box.name} inside the panel`).toBeLessThanOrEqual(
          panel.x + panel.width + 1,
        );
        expect(box.top, `${box.name} inside the panel`).toBeGreaterThanOrEqual(panel.y - 1);
        expect(box.bottom, `${box.name} inside the panel`).toBeLessThanOrEqual(
          panel.y + panel.height + 1,
        );
      }
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const apart =
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          expect(apart, `${a.name} and ${b.name} don't overlap`).toBe(true);
        }
      }
      await shot(page, `planning-home-bike-labels-${viewport.height}`);
    });
  });
}

test.describe("on the cover screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 900 } });

  test("the bike has its pins, and every part is listed under it", async ({ page }) => {
    const name = `Trail bike ${Date.now()}`;
    await newWorkspace(page, name);
    // On the cover screen the box opens with Type.
    await page.getByRole("button", { name: "Type" }).tap();
    await addBike(page, name);

    await expect(
      bike(page).getByRole("img", { name: "Drawing of Boardman MHT 8.6" }),
    ).toBeVisible();
    await expect(bike(page).getByRole("list", { name: "Parts" }).getByRole("link")).toHaveText([
      "Saddle",
      "Grips",
      "Fork",
      "Brakes",
      "Drivetrain",
      "Pedals · DMR V8 next",
      "Front tyre",
      "Rear tyre",
      "Bottle cage",
    ]);
    await shot(page, "planning-home-drawn-bike-cover");
  });
});

test("the tabs appear as the workspace fills, and Home with nothing to draw is one quiet line and the box", async ({
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
  const quiet = page.getByText("A bike and its parts, or a room's floor plan, shows here.");
  await expect(quiet).toBeVisible();
  await expect(messageBox(page)).toBeVisible();
  await expect(messageBox(page)).toHaveAttribute("placeholder", "Talk or type to start a session…");

  await openTab(page, "Things");
  await expect(page.getByRole("region", { name: "Things" })).toContainText("Shelving");
  await openTab(page, "Docs");
  await expect(page.getByRole("region", { name: "Documents" })).toContainText("Shelf sizes");
  await openTab(page, "History");
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(1);
  await openTab(page, "Home");
  await expect(quiet).toBeVisible();
});

test("+ New opens the box to start another session", async ({ page }) => {
  const name = `Trail bike ${Date.now()}`;
  await newWorkspace(page, name);
  await addBike(page, name);

  await page.getByRole("button", { name: "+ New" }).click();
  const box = messageBox(page);
  await expect(box).toBeFocused();
  await box.fill("Where do I ride this weekend?");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Where do I ride this weekend?",
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "History");
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(2);
});

test("What Courtyard knows holds the facts and ideas, and a line is fixed by starting a session on it", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await openWhatCourtyardKnows(page);

  await expect(page.getByRole("region", { name: "Facts" })).toContainText("up-and-over door");
  // Plans went with projects (#603): a Plans section from before is kept as written, with no Fix.
  await expect(page.getByRole("region", { name: "Plans" })).toHaveCount(0);
  await expect(page.getByText("A squat rack on the left wall.")).toBeVisible();
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
