import { expect, type Page, test } from "@playwright/test";
import { openWhatCourtyardKnows } from "./workspace-page.ts";

// Skills (ADR 0016), with the fixtures' skills: Programme check and a broken warm-up in Garage
// gym, Shopping list and Ride log chart (which has a script) for every workspace, and the house
// Get to know, Get to know me and Grilling.

// Skills come from the frame's Skills sheet (#194; on every screen since #197).
const skillsSheet = async (page: Page) => {
  await page.getByRole("button", { name: "Skills" }).click();
  const sheet = page.getByRole("dialog", { name: "Skills" });
  await expect(sheet).toBeVisible();
  return sheet;
};

test("the owner picks a skill on the Skills sheet and starts a session with it, shown as a tag", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  const sheet = await skillsSheet(page);
  await expect(sheet.getByRole("list", { name: "Skills" }).getByRole("button")).toHaveText([
    /^Get to know/,
    /^Get to know me/,
    /^Grilling/,
    /^Programme check/,
    /^Shopping list/,
    /^Ride log chart/,
    /^warm-up/,
  ]);
  await expect(sheet.getByRole("button", { name: /^Ride log chart/ })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: /^warm-up/ })).toBeDisabled();

  await sheet.getByRole("button", { name: /^Programme check/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Skill: Programme check")).toBeVisible();

  await page.getByLabel("Message", { exact: true }).fill("Does next week fit around the rides?");
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Does next week fit around the rides?");
  await expect(session.getByText("Skill: Programme check")).toBeVisible();
  // The tag says it: no "Used" line for a skill the owner started.
  await expect(page.getByRole("list", { name: "What the model did" })).toHaveCount(0);
});

test("a skill picked on the Skills sheet can be taken off again", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  const sheet = await skillsSheet(page);
  await sheet.getByRole("button", { name: /^Shopping list/ }).click();
  await expect(page.getByText("Skill: Shopping list")).toBeVisible();

  await page.getByRole("button", { name: "Take off the Shopping list skill" }).click();
  await expect(page.getByText("Skill: Shopping list")).toBeHidden();
});

test("the chat says which skill the model used, and which of its files it read, after a reload too", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym#new");
  await page
    .getByLabel("Message", { exact: true })
    .fill("use skill programme-check\nuse skill programme-check references/deload-weeks.md");
  await page.getByRole("button", { name: "Start" }).click();

  const did = page.getByRole("list", { name: "What the model did" });
  const lines = ["Used Programme check", "Read Programme check's references/deload-weeks.md"];
  await expect(did.getByRole("listitem")).toHaveText(lines);
  await page.reload();
  await expect(did.getByRole("listitem")).toHaveText(lines);
});

test("the workspace page lists its skills, where each comes from, and why any can't be used", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await openWhatCourtyardKnows(page);

  const section = page.getByRole("region", { name: "Skills" });
  await expect(section.getByRole("listitem")).toHaveText([
    /^Get to knowGets to know a workspace.*Only you start it\.House$/,
    /^Get to know meGets to know the owner.*Only you start it\.House$/,
    /^Grilling.*House$/,
    /^Programme checkChecks a training week against my kit and timeYours$/,
    /^Shopping listTurns a plan into a list of things to buyYours, everywhere$/,
    /^Ride log chartNeeds a code workspace: it runs a scriptYours, everywhere$/,
    /^warm-upCan't be used: its SKILL\.md has no descriptionYours$/,
  ]);
  await expect(section).toContainText(
    "Add your own: a folder with a SKILL.md, in an .agents/skills folder in this workspace's folder, or at the top of your context folder for every workspace.",
  );
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the bar's Skills picks one for the next message, which goes with it", async ({ page }) => {
    await page.goto("/workspaces/garage-gym#new");
    await page.getByRole("button", { name: "Type" }).click();
    await page.getByLabel("Message", { exact: true }).fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");

    const sheet = await skillsSheet(page);
    await sheet.getByRole("button", { name: /^Grilling/ }).click();
    await expect(sheet).toBeHidden();
    // Picking one opens the box with the skill in it.
    await expect(page.getByText("Skill: Grilling")).toBeVisible();

    await page.getByLabel("Message", { exact: true }).fill("The rack plan.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: The rack plan.",
    );
    await expect(
      page.getByRole("list", { name: "Session" }).getByText("Skill: Grilling"),
    ).toBeVisible();
  });
});
