import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

/** The browser tests' context folder (see playwright.config.ts). */
const OWNER_FILE = join(import.meta.dirname, "..", "test-results", "e2e", "context", "OWNER.md");

test("the owner starts their owner context, fills it in, and each workspace says it reads it", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Owner context" });

  await panel.getByRole("button", { name: "Start your owner context" }).click();

  await expect(panel.getByRole("region", { name: "Facts" })).toContainText("Nothing yet.");
  await expect(panel.getByRole("region", { name: "How to answer me" })).toContainText(
    "Nothing yet.",
  );
  await expect(panel.getByRole("button", { name: "Start your owner context" })).toHaveCount(0);
  // The untouched starter has no lines, so no workspace reads it yet.
  await page.goto("/workspaces/garage-gym");
  await expect(page.getByText("Also reads")).toHaveCount(0);

  // Filled in by hand, as the owner does until phase 2, and long enough to warn about.
  const facts = Array.from({ length: 70 }, (_, n) => `- Fact number ${n + 1} about the owner.`);
  writeFileSync(
    OWNER_FILE,
    ["## About me", "### Facts", ...facts, "## How to answer me", "- Metric units."].join("\n"),
  );

  await page.reload();
  await page.getByRole("link", { name: "your owner context" }).click();
  await expect(panel.getByRole("region", { name: "How to answer me" })).toContainText(
    "Metric units.",
  );
  await expect(panel.getByRole("status")).toContainText("Getting long");
});

// After the test above, so the owner context it fills in is there to save to.
test("a save to the owner context names its place, shows on the home page, and Edit moves it", async ({
  page,
}) => {
  const name = `Knee ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save owner fact: Has a bad left knee.");

  const notes = page.getByRole("list", { name: "Saved to context" });
  await expect(notes).toContainText("Saved to Owner context → About me → Facts");
  await expect(notes).toContainText("Has a bad left knee.");
  const session = page.url();
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Owner context" });
  await expect(panel.getByRole("region", { name: "Facts" })).toContainText("Has a bad left knee.");

  // Moved to the workspace: out of the owner context, into the workspace's facts.
  await page.goto(session);
  await notes.getByRole("button", { name: "Edit" }).click();
  await notes.getByRole("group", { name: "Place" }).getByText("Workspace").click();
  await notes.getByRole("button", { name: "Save" }).click();
  await expect(notes).toContainText("Saved to Facts · edited");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText("Has a bad left knee.");
  await page.goto("/");
  await expect(panel.getByRole("region", { name: "Facts" })).not.toContainText("left knee");
});
