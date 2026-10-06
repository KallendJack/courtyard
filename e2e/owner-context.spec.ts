import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

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
