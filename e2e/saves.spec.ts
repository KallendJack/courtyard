import { expect, type Page, test } from "@playwright/test";

/** A workspace of its own, so the test can run again on the same worker; opens it. */
const newWorkspace = async (page: Page, name: string) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("link", { name: "New workspace" })
    .click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Add workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
};

/** Starts a session whose message scripts the fake provider's saves, and waits for its answer. */
const startSaving = async (page: Page, message: string) => {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");
};

test("a save shows as a note under the answer, and Undo takes it out of the context file", async ({
  page,
}) => {
  const name = `Padel ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save fact: Padel lessons on Tuesdays.");

  const notes = page.getByRole("list", { name: "Saved to context" });
  await expect(notes).toContainText("Saved to Facts");
  await expect(notes).toContainText("Padel lessons on Tuesdays.");
  const session = page.url();
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText(
    "Padel lessons on Tuesdays.",
  );

  await page.goto(session);
  await notes.getByRole("button", { name: "Undo" }).click();
  await expect(notes).toContainText("Undone");
  await expect(notes.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText("Nothing yet.");
});

test("Edit changes a saved line's wording and section where it is", async ({ page }) => {
  const name = `Gym days ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save fact: Gym on Monday and Thursday.");

  const notes = page.getByRole("list", { name: "Saved to context" });
  await notes.getByRole("button", { name: "Edit" }).click();
  await notes
    .getByRole("textbox", { name: "Saved line" })
    .fill("Gym on Monday and Thursday evenings.");
  // Clicked as a person would: the radio itself is hidden behind its pill.
  await notes.getByRole("group", { name: "Section" }).getByText("Plans").click();
  await notes.getByRole("button", { name: "Save" }).click();

  await expect(notes).toContainText("Saved to Plans · edited");
  await expect(notes).toContainText("Gym on Monday and Thursday evenings.");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Plans" })).toContainText(
    "Gym on Monday and Thursday evenings.",
  );
  await expect(page.getByRole("region", { name: "Facts" })).toContainText("Nothing yet.");
});
