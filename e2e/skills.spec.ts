import { expect, test } from "@playwright/test";

// Skills (ADR 0016), with the fixtures' skills: Programme check and a broken warm-up in Garage
// gym, Shopping list and Ride log chart (which has a script) for every workspace, and the house
// Get to know, Get to know me and Grilling.

test("the owner picks a skill with / and starts a session with it, shown as a tag", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  const box = page.getByLabel("Message");

  await box.fill("/");
  const list = page.getByRole("listbox", { name: "Skills in Garage gym" });
  await expect(list.getByRole("option")).toHaveText([
    /^Get to knowGets to know a workspace.*House$/,
    /^Get to know meGets to know the owner.*House$/,
    /^Grilling.*House$/,
    /^Programme checkChecks a training week against my kit and timeYours$/,
    /^Shopping listTurns a plan into a list of things to buyYours, everywhere$/,
    /^Ride log chartNeeds a code workspace: it runs a scriptYours, everywhere$/,
    /^warm-upCan't be used: its SKILL\.md has no descriptionYours$/,
  ]);
  await expect(list.getByRole("option", { name: /^Ride log chart/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // Typing more narrows it, and Enter picks the highlighted one.
  await box.fill("/prog");
  await expect(list.getByRole("option")).toHaveText([/^Programme check/]);
  await box.press("Enter");
  await expect(list).toBeHidden();
  await expect(box).toHaveValue("");
  await expect(page.getByText("Skill: Programme check")).toBeVisible();

  await box.fill("Does next week fit around the rides?");
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Does next week fit around the rides?");
  await expect(session.getByText("Skill: Programme check")).toBeVisible();
  // The tag says it: no "Used" line for a skill the owner started.
  await expect(page.getByRole("list", { name: "What the model did" })).toHaveCount(0);
});

test("a skill picked with the Skill pill can be taken off again", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");

  await page.getByRole("button", { name: "Skill", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Skills in Garage gym" })
    .getByRole("option", { name: /^Shopping list/ })
    .click();
  await expect(page.getByText("Skill: Shopping list")).toBeVisible();

  await page.getByRole("button", { name: "Take off the Shopping list skill" }).click();
  await expect(page.getByText("Skill: Shopping list")).toBeHidden();
});

test("the chat says which skill the model used, and which of its files it read, after a reload too", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await page
    .getByLabel("Message")
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

  test("the Skill chip opens a sheet to pick one, which sits in the one-line box", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByLabel("Message").fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");

    await page.getByRole("button", { name: "Skill", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Use a skill" });
    await sheet.getByRole("button", { name: /^Grilling/ }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Skill: Grilling")).toBeVisible();

    await page.getByLabel("Message").fill("The rack plan.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: The rack plan.",
    );
    await expect(
      page.getByRole("list", { name: "Session" }).getByText("Skill: Grilling"),
    ).toBeVisible();
  });
});
