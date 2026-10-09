import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Grill this plan (docs/ai-conduct.md, Grilling): a flame beside each Plan line.

test("Grill this plan starts a session on the plan with the Grilling tag, and an agreed decision changes its line", async ({
  page,
}) => {
  const name = `Allotment ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save plan: Dig the new beds in March.");
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  await page
    .getByRole("region", { name: "Plans" })
    .getByRole("button", { name: "Grill this plan" })
    .click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(page.getByRole("heading", { name: "Dig the new beds in March." })).toBeVisible();
  await expect(session.getByText("Skill: Grilling")).toBeVisible();
  await expect(session).toContainText("You said: Dig the new beds in March.");

  // The owner agrees a decision that sharpens the plan: its line changes, with the usual note.
  await page.getByLabel("Message").fill("change P1 to plan: Dig the new beds in late March.");
  await page.getByRole("button", { name: "Send" }).click();
  const notes = page.getByRole("list", { name: "Saved to context" });
  await expect(notes).toContainText("Dig the new beds in late March.");
  await expect(notes.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const plans = page.getByRole("region", { name: "Plans" });
  await expect(plans.getByRole("listitem")).toHaveText(["Dig the new beds in late March."]);
});

test("only a workspace's plans can be grilled, not its facts or ideas", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");

  await expect(
    page.getByRole("region", { name: "Plans" }).getByRole("button", { name: "Grill this plan" }),
  ).toHaveCount(1);
  for (const section of ["Facts", "Ideas"]) {
    await expect(
      page.getByRole("region", { name: section }).getByRole("button", { name: "Grill this plan" }),
    ).toHaveCount(0);
  }
});
