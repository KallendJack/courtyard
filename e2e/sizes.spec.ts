import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openWhatCourtyardKnows } from "./workspace-page.ts";

// Sizes (#708, ADR 0037): the model's size tool records a size of a Thing, shown as a note under
// its answer with Undo, as a Build's is, and Recent changes lists it. The worker's side is in
// sizes.test.ts.

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** The fake's line recording a size, with the tool's input as JSON. */
const recordSize = (input: object) => `size: ${JSON.stringify(input)}`;

test("a size save's note offers Undo, and Recent changes lists the size", async ({ page }) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    [
      "thing add: name Garage | status have",
      recordSize({
        thing: "garage",
        property: "floor length",
        amount: 5137,
        unit: "mm",
        source: "measured",
      }),
    ].join("\n"),
  );
  const note = page.getByRole("list", { name: "Sizes saved" });
  await expect(note).toContainText("Recorded size");
  await expect(note).toContainText("Garage: floor length");
  await expect(note).toContainText("5137 mm · measured");
  await note.getByRole("button", { name: "Undo" }).click();
  await expect(note).toContainText("Undone");

  // Recent changes lists the size, marked undone, as an undo shows.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openWhatCourtyardKnows(page);
  await page.getByRole("link", { name: "Recent changes" }).click();
  const changes = page.getByRole("list", { name: "Recent changes" }).getByRole("listitem");
  await expect(changes.filter({ hasText: "floor length" })).toContainText("added, then undone");
});
