import { expect, test } from "@playwright/test";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";
import { openWhatCourtyardKnows } from "./workspace-page.ts";

// Builds (#697, ADR 0036): the model's Build tool starts one, shown as a note under its answer
// with Undo, as a project's is, and Recent changes lists it. The worker's side is in
// fabrication.test.ts; a Build opens in Fabrication (#698).

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** The fake's line starting a Build, with the tool's input as JSON. */
const startBuild = (input: object) => `build: ${JSON.stringify(input)}`;

test("a Build save's note offers Undo, and Recent changes lists the Build", async ({ page }) => {
  const name = `Workshop ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    startBuild({ name: "Workbench", template: "framed-bench", parameters: goldenBench }),
  );
  const note = page.getByRole("list", { name: "Builds saved" });
  await expect(note).toContainText("Started Build");
  await expect(note).toContainText("Workbench");
  await note.getByRole("button", { name: "Undo" }).click();
  await expect(note).toContainText("Undone");

  // Recent changes lists the start, marked undone, as an undo shows.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);
  await page.getByRole("link", { name: "Recent changes" }).click();
  const changes = page.getByRole("list", { name: "Recent changes" }).getByRole("listitem");
  await expect(changes).toHaveCount(1);
  await expect(changes).toContainText("UndoneWorkbench");
  await expect(changes).toContainText("added, then undone");
});
