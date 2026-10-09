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
  await expect(box).toHaveValue(/Twelve weeks/);
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
