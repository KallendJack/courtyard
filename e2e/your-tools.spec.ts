import { expect, type Page, test } from "@playwright/test";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";

// Your tools in Fabrication (#707; Paper, 2 · Agreed, "Fabrication · Your tools, first open",
// tablet and desktop): the owner's tools, ticked once, saved at the owner's level with Undo. It
// comes before the first Build, and from a Build's Tools. The worker's side is in tools.test.ts.

// The owner's tools are the same for every test on the worker: these run one after another, each
// starting with none saved and ending with its Save undone.
test.describe.configure({ mode: "serial" });

/** No tools saved at the owner's level, as before the first Build. */
const noToolsSaved = async (page: Page) => {
  const cleared = await page.request.put("/api/fabrication/tools", { data: { tools: [] } });
  // 400 when there were none to clear.
  expect([200, 400]).toContain(cleared.status());
};

/**
 * A workspace with a tenon saw in its Things, which is the Hand saw tile, and the golden bench as
 * its project's step's Build.
 */
const garageWithBuild = async (page: Page) => {
  await newWorkspace(page, `Tools garage ${Date.now()}`);
  await startSaving(
    page,
    [
      "thing add: name Tenon saw | status have",
      `project: ${JSON.stringify({
        name: "Make a bench",
        add_steps: [{ who: "you", text: "Build the bench" }],
      })}`,
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Projects saved" })).toContainText("Started project");
  await page.getByRole("link", { name: /^Back to Tools garage/ }).click();
  await startSaving(
    page,
    `build: ${JSON.stringify({
      name: "Tools bench",
      template: "framed-bench",
      parameters: goldenBench,
      project: "P1",
      step: 1,
    })}`,
  );
  await expect(page.getByRole("list", { name: "Builds saved" })).toContainText("Started Build");
  await page.getByRole("link", { name: /^Back to Tools garage/ }).click();
  await page
    .getByRole("region", { name: "Projects" })
    .getByRole("link", { name: "Make a bench" })
    .click();
  await page
    .getByRole("region", { name: "Next" })
    .getByRole("link", { name: "Open in Fabrication" })
    .click();
};

const tile = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("Your tools comes first, ticks, counts, adds your own, hears them, saves with Undo, and skips", async ({
    page,
  }) => {
    await noToolsSaved(page);
    await garageWithBuild(page);

    // Before the first Build, as the board has it.
    await expect(page).toHaveURL(/\/fabrication\/tools\?back=/);
    await expect(page.getByRole("heading", { level: 1, name: "Your tools" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What's in your garage?" })).toBeVisible();
    await expect(page.getByText("Before your first Build")).toBeVisible();
    for (const group of [
      "Cutting",
      "Holding and measuring",
      "Drilling and fixing",
      "Finishing and printing",
    ]) {
      await expect(page.getByRole("heading", { name: group })).toBeVisible();
    }
    // The garage's tenon saw comes ticked as the Hand saw, saying what moves with the Save.
    await expect(tile(page, "Hand saw")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/^Tenon saw · from Tools garage \d+$/)).toBeVisible();
    await expect(tile(page, "Hand saw")).toHaveAccessibleDescription(
      /^Tenon saw · from Tools garage \d+$/,
    );
    await expect(tile(page, "Jigsaw")).toHaveAttribute("aria-pressed", "false");

    // Ticking, and a count.
    await tile(page, "Workmate").click();
    await tile(page, "Clamps").click();
    await page.getByRole("button", { name: "One more Clamps" }).click();
    await expect(tile(page, "Clamps × 2")).toHaveAttribute("aria-pressed", "true");

    // Add your own.
    await page.getByRole("button", { name: "Add your own" }).click();
    await page.getByLabel("Your own tool").fill("Router");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(tile(page, "Router")).toHaveAttribute("aria-pressed", "true");

    // Ticking 3D printer asks which one.
    await tile(page, "3D printer").click();
    await page.getByLabel("Make and model").fill("Bambu Lab P1S");
    await page.getByLabel("Plate size").fill("256 × 256 × 256 mm");

    // Or just say it: the model ticks the tiles, and nothing is saved yet.
    await page.getByLabel("Your tools, in your words").fill("a square and two sawhorses");
    await page.getByRole("button", { name: "Tick them" }).click();
    await expect(tile(page, "Square")).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, "Sawhorses × 2")).toHaveAttribute("aria-pressed", "true");

    // Save, then its Undo.
    await page.getByRole("button", { name: "Save 7 tools" }).click();
    await expect(page.getByRole("status")).toContainText("Saved your tools.");
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save 7 tools" })).toBeDisabled();
    // Moved, it's still the owner's tenon saw.
    await expect(tile(page, "Hand saw")).toHaveAccessibleDescription("Tenon saw");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("status")).toContainText("Undone: your tools are as they were.");
    // The tenon saw is back in the garage, so it comes ticked again.
    await expect(tile(page, "Hand saw")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/^Tenon saw · from Tools garage \d+$/)).toBeVisible();
    await expect(tile(page, "Workmate")).toHaveAttribute("aria-pressed", "false");

    // Skip for now goes straight on to the Build.
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tools bench" })).toBeVisible();
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Your tools opens again from a Build's Tools, and goes back to it", async ({ page }) => {
    await noToolsSaved(page);
    await garageWithBuild(page);
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tools bench" })).toBeVisible();

    await page.getByRole("tab", { name: "Tools" }).click();
    await page
      .getByRole("region", { name: "Tools" })
      .getByRole("link", { name: "Your tools" })
      .click();
    await expect(page.getByRole("heading", { name: "What's in your garage?" })).toBeVisible();

    await tile(page, "Jigsaw").click();
    await page.getByRole("button", { name: "Save 2 tools" }).click();
    await expect(page.getByRole("status")).toContainText("Saved your tools.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("status")).toContainText("Undone");

    await page.getByRole("link", { name: "Back to the Build" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tools bench" })).toBeVisible();
  });
});
