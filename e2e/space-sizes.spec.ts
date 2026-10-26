import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// A space's sizes in Fabrication (#709; Paper, 2 · Agreed, "Fabrication · Sizes in the room's
// Things panel · Tablet (#709)"): the Things panel with each size's source and day, two answers
// side by side, a correction and its Undo, and the old sizes in a sentence confirmed once with a
// tick. The worker's side is in spaces.test.ts.

const UNFOLDED = { width: 933, height: 645 };
const FOLDED = { width: 476, height: 695 };
const DESKTOP = { width: 1440, height: 900 };

const recordSize = (input: object) => `size: ${JSON.stringify(input)}`;

/**
 * A workspace with a garage (a space), a bench whose length was given twice, differently, and a
 * Fact with the garage's rough sizes in it. Opens the garage in Fabrication.
 */
const garageInFabrication = async (page: Page) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    [
      "thing add: name Garage | status have | kind space",
      "thing add: name Bench | status have",
      "save fact: The garage is about 2735 mm wide and 5137 mm long.",
      ...[1500, 1520].map((amount) =>
        recordSize({ thing: "bench", property: "Length", amount, unit: "mm", source: "reported" }),
      ),
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  await expect(page.getByRole("list", { name: "Sizes saved" })).toContainText("1520 mm");
  await expect(page.getByRole("list", { name: "Saved to context" })).toContainText("2735 mm");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const [, id] = /\/workspaces\/([^/?#]+)/.exec(page.url()) ?? [];
  await page.goto(`/fabrication/workspaces/${id}/spaces/garage`);
  await expect(page.getByRole("heading", { level: 1, name: "Garage" })).toBeVisible();
};

/** The Things panel's line for a size. */
const line = (page: Page, thing: string, property: string) =>
  page
    .getByRole("region", { name: `${thing} sizes` })
    .getByRole("listitem")
    .filter({ hasText: property });

/** Confirms the old sizes: the length ticked as measured, the width left as about. */
const confirmOldSizes = async (page: Page) => {
  const list = page.getByRole("dialog", { name: "Old sizes to confirm" });
  await expect(list).toContainText("“The garage is about 2735 mm wide and 5137 mm long.” · Facts");
  await list
    .getByRole("group", { name: "Inside length, 5137 mm" })
    .getByText("Measured", { exact: true })
    .click();
  await list.getByRole("button", { name: "Record 2 sizes" }).click();
  await expect(list).toBeHidden();
};

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

  test("the old sizes are confirmed once, a tick making one measured", async ({ page }) => {
    await garageInFabrication(page);
    await confirmOldSizes(page);

    await expect(line(page, "Garage", "Inside length")).toContainText("measured · just now");
    await expect(line(page, "Garage", "Inside length")).toContainText("5137 mm");
    await expect(line(page, "Garage", "Inside width")).toContainText("about 2735 mm");
    await expect(page.getByText("Recorded the old sizes")).toBeVisible();
    await expect(page.getByRole("button", { name: /old sizes?$/ })).toBeHidden();

    // Opened again, nothing is offered.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Garage" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Old sizes to confirm" })).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("space-sizes-unfolded.png") });
  });

  test("a size measured again keeps the old value beside it, and Undo takes it back", async ({
    page,
  }) => {
    await garageInFabrication(page);
    await confirmOldSizes(page);

    // The guided re-measure is on the width, the first size not measured.
    const measuring = page.getByRole("region", { name: "Measuring" });
    await expect(measuring.getByRole("heading", { name: "Inside width" })).toBeVisible();
    await expect(measuring).toContainText("Measure wall to wall, at the back, on the floor.");
    await expect(line(page, "Garage", "Inside width")).toContainText("measuring next");
    // The rough figure is only the hint: nothing becomes measured without the owner's number.
    await expect(measuring.getByLabel("Size")).toHaveValue("");
    await expect(measuring.getByRole("button", { name: "Save" })).toBeDisabled();
    await measuring.getByLabel("Size").fill("2741");
    await measuring.getByRole("button", { name: "Save" }).click();

    const width = line(page, "Garage", "Inside width");
    await expect(width).toContainText("2741 mm");
    await expect(width).toContainText("was about 2735 mm");
    await expect(width).toContainText("measured · just now");
    await expect(page.getByText("Corrected Inside width")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(width).toContainText("about 2735 mm");
    await expect(width).not.toContainText("2741");
  });

  test("two answers show side by side, and keeping one settles them", async ({ page }) => {
    await garageInFabrication(page);
    const oldSizes = page.getByRole("dialog", { name: "Old sizes to confirm" });
    await oldSizes.getByRole("button", { name: "Done" }).click();
    await expect(oldSizes).toBeHidden();
    // Closed, they wait behind a button in the header.
    await expect(page.getByRole("button", { name: "2 old sizes" })).toBeVisible();

    const length = line(page, "Bench", "Length");
    await expect(length).toContainText("about 1500 mm / about 1520 mm");
    await expect(length).toContainText("two answers · check by tapping it");
    await page.getByRole("button", { name: "1 to check" }).click();
    const sheet = page.getByRole("dialog", { name: "Length" });
    await sheet
      .getByRole("group", { name: "about 1520 mm" })
      .getByRole("button", { name: "Keep this" })
      .click();
    // One answer stands, the one it replaced under it.
    await expect(length).toContainText("about · just now");
    await expect(length).toContainText("about 1520 mmwas about 1500 mm");
    await expect(page.getByRole("button", { name: "1 to check" })).toBeHidden();
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("the Things panel beside the size being measured", async ({ page }) => {
    await garageInFabrication(page);
    await confirmOldSizes(page);
    await expect(page.getByRole("region", { name: "Measuring" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Things" })).toBeVisible();
    await expect(line(page, "Garage", "Inside width")).toContainText("measuring next");
    await expect(page.getByText("re-measuring · 1 of 3 · space")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("space-sizes-desktop.png") });
  });
});

test.describe("folded", () => {
  test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

  test("the Things panel alone, and Next size opens the size to measure", async ({ page }) => {
    await garageInFabrication(page);
    await confirmOldSizes(page);
    await page.setViewportSize(FOLDED);
    await expect(page.getByRole("region", { name: "Measuring" })).toBeHidden();
    await page.screenshot({ path: test.info().outputPath("space-sizes-folded.png") });
    await page.getByRole("button", { name: "Next size" }).click();
    const sheet = page.getByRole("dialog", { name: "Inside width" });
    await expect(sheet).toContainText("Measure wall to wall, at the back, on the floor.");
  });
});
