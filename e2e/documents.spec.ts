import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Documents (ADR 0020): Save as document under an answer, the workspace's list, a document's page
// with Rename and Delete, and Undo from each.

test("Save as document keeps an answer as a document, listed on the workspace page and opened from its note", async ({
  page,
}) => {
  const name = `Padel ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "Twelve weeks of lessons, every fourth one lighter.");

  await page.getByRole("button", { name: "Save as document" }).click();
  const box = page.getByRole("textbox", { name: "Document name" });
  // The session's title: its first message, or the title a model gives it once the turn is done.
  await expect(box).toHaveValue(/Twelve weeks/i);
  await expect(page.getByText(`Saves the whole answer to ${name}'s documents.`)).toBeVisible();
  await box.fill("Padel plan to Christmas");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const notes = page.getByRole("list", { name: "Documents saved" });
  await expect(notes).toContainText("Saved document");
  await expect(notes).toContainText("Padel plan to Christmas");
  await notes.getByRole("link", { name: "Open" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Padel plan to Christmas" }),
  ).toBeVisible();
  await expect(page.getByText("docs/padel-plan-to-christmas.md")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("You said: Twelve weeks of lessons");

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const documents = page.getByRole("region", { name: "Documents" });
  await expect(documents.getByRole("link", { name: /Padel plan to Christmas/ })).toBeVisible();

  // Undone from its note, it leaves the list.
  await page.goBack();
  await page.goBack();
  await notes.getByRole("button", { name: "Undo" }).click();
  await expect(notes).toContainText("Undone");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Documents" })).toHaveCount(0);
});

test("a document's page renames it, and Delete goes at once with Undo on the workspace page", async ({
  page,
}) => {
  const name = `Bilbao ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save document\n# Packing list\n\n- Two rackets\n- Trainers");
  const notes = page.getByRole("list", { name: "Documents saved" });
  await expect(notes).toContainText("Saved document");
  await notes.getByRole("link", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Packing list" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Two rackets" })).toBeVisible();

  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Document name" }).fill("Bilbao kit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bilbao kit" })).toBeVisible();
  await expect(page).toHaveURL(/\/documents\/bilbao-kit$/);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const documents = page.getByRole("region", { name: "Documents" });
  await expect(documents).toContainText("Deleted");
  await expect(documents).toContainText("Bilbao kit");
  await documents.getByRole("button", { name: "Undo" }).click();
  await expect(documents.getByRole("link", { name: /Bilbao kit/ })).toBeVisible();
  await expect(documents).not.toContainText("Deleted");

  // Each change is in Recent changes too, the delete marked undone.
  await page.getByRole("link", { name: "Recent changes" }).click();
  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes).toContainText("Renamed documentBilbao kit (was Packing list)");
  await expect(changes).toContainText("Saved documentPacking list");
  await expect(changes.getByRole("listitem").first()).toContainText("Undone");
});

test("a model's update shows what changed in its note", async ({ page }) => {
  const name = `Kit ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save document\n# Packing list\n\n- Two rackets");
  await expect(page.getByRole("list", { name: "Documents saved" })).toContainText("Saved document");

  await page
    .getByLabel("Message")
    .fill(
      "read file: docs/packing-list.md\nupdate document docs/packing-list.md: added grips\n# Packing list\n\n- Two rackets\n- Grips",
    );
  await page.getByRole("button", { name: "Send" }).click();

  const updated = page.getByRole("list", { name: "Documents saved" }).nth(1);
  await expect(updated).toContainText("Updated document");
  await expect(updated).toContainText("Packing list");
  await expect(updated).toContainText("(added grips)");
});

test("a document's tables sort on its page, as in an answer", async ({ page }) => {
  const name = `Rackets ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    [
      "save document",
      "# Which padel racket?",
      "",
      "| Racket | Price |",
      "| --- | --- |",
      "| Bullpadel Indiga CTR | £139 |",
      "| Head Evo Speed | £95 |",
      "| Babolat Contact | £110 |",
    ].join("\n"),
  );
  const notes = page.getByRole("list", { name: "Documents saved" });
  await expect(notes).toContainText("Saved document");
  await notes.getByRole("link", { name: "Open" }).click();

  const table = page.getByRole("main").getByRole("table");
  const price = table.getByRole("columnheader", { name: "Price" });
  await price.getByRole("button").click();
  await expect(price).toHaveAttribute("aria-sort", "ascending");
  expect(await table.locator("tbody tr td:first-child").allTextContents()).toEqual([
    "Head Evo Speed",
    "Babolat Contact",
    "Bullpadel Indiga CTR",
  ]);
});
