import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// A planning workspace's Home (#300; Paper, "Tablet · Planning workspace Home"): its tabs (Home ·
// Sessions · Things · Docs), each but Home once it has something; Next up; What Courtyard knows;
// and the message box, which starts a new session.

/** A day `days` from now as a plan would name it: "14 October". */
const dayFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });

test("a new workspace's Home is only its name, one line and the message box", async ({ page }) => {
  const name = `Shed ${Date.now()}`;
  await newWorkspace(page, name);

  await expect(page.getByText("Tell Courtyard about this, by voice or photo")).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace tabs" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Next up" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "What Courtyard knows" })).toHaveCount(0);
});

test("the tabs appear as the workspace fills, and Next up picks up the session with this week's plans", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  const due = `Fit the sensor magnet by ${dayFromNow(2)}.`;
  await startSaving(
    page,
    [
      `save plan: ${due}`,
      "save plan: Pick shelving that fits the back wall.",
      "thing add: name Shelving | status want",
      "save document",
      "# Shelf sizes",
      "",
      "The back wall is 2.4 m.",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Things saved" })).toContainText("Shelving");
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Sessions1", "Things1", "Docs1"]);

  // Next up: the session to pick up again, then the plans dated in the next 7 days, and no others.
  const nextUp = page.getByRole("region", { name: "Next up" });
  await expect(nextUp.getByRole("link", { name: /^Pick up: / })).toBeVisible();
  await expect(nextUp).toContainText(due);
  await expect(nextUp).not.toContainText("Pick shelving");

  await tabs.getByRole("link", { name: /^Things/ }).click();
  await expect(page.getByRole("region", { name: "Things" })).toContainText("Shelving");
  await expect(page.getByRole("region", { name: "Next up" })).toHaveCount(0);
  await tabs.getByRole("link", { name: /^Docs/ }).click();
  await expect(page.getByRole("region", { name: "Documents" })).toContainText("Shelf sizes");
  await tabs.getByRole("link", { name: /^Sessions/ }).click();
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(1);

  // Back a tab, then Home again; the pick-up row opens its session.
  await page.goBack();
  await expect(page.getByRole("region", { name: "Documents" })).toBeVisible();
  await tabs.getByRole("link", { name: "Home" }).click();
  await page
    .getByRole("region", { name: "Next up" })
    .getByRole("link", { name: /^Pick up: / })
    .click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");
});

test("What Courtyard knows holds the facts, plans and ideas, and a line is fixed by starting a session on it", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByRole("link", { name: "What Courtyard knows" }).click();

  await expect(page.getByRole("region", { name: "Facts" })).toContainText("up-and-over door");
  await expect(page.getByRole("region", { name: "Plans" })).toContainText("squat rack");
  await expect(page.getByRole("region", { name: "Ideas" })).toContainText("Rubber flooring");
  await expect(page.getByRole("region", { name: "Skills" })).toBeVisible();

  // A tap on a line shows the session it starts, all of it, before a second tap starts it.
  await page.getByRole("button", { name: "Fix: Rubber flooring." }).click();
  const fixing = page.getByRole("group", { name: "Fix this line" });
  await expect(fixing).toContainText('Starts a session: "This line is wrong: Rubber flooring."');
  await fixing.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: This line is wrong: Rubber flooring.",
  );
});
