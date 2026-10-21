import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openTab, openWhatCourtyardKnows } from "./workspace-page.ts";

// The move review (#603, ADR 0032; Paper, "2 · Agreed", planning workspace row: "Tablet · Move
// review: guides to projects and parts, ticked (#603)"): once, Home is the review, each move
// ticked; only the ticked ones move, each with Undo, and Home is itself again. The worker's side
// is in move-review.test.ts.

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** A move the fake proposes, as a line of the workspace's files scripts it. */
const move = (proposed: object) => `move: ${JSON.stringify(proposed)}`;

const JOURNEY = move({
  title: "MTB journey guide → a project",
  about: "Ride red trails with confidence: skills as its steps, next up as Next",
  project: {
    name: "Ride red trails with confidence",
    steps: [{ kind: "you can do this", text: "The cornering drill on Saturday's ride" }],
  },
  remove: { documents: ["mtb-journey-guide"] },
});
const PEDALS = move({
  title: "Payday upgrade list → upcoming parts",
  about: "The pedals go onto the bike as upcoming",
  upcoming: [{ part: "pedals", name: "DMR V8", price: "about £30" }],
  remove: { things: ["dmr-v8-pedals"] },
});
const DAY_ONE = move({
  title: "Day one guide → archive",
  about: "Done: you've had day one. Kept, out of the way",
  archive: ["day-one-guide"],
});

test("the move review: Home shows each move ticked, and only the ticked ones move, each with Undo", async ({
  page,
}) => {
  const name = `Trail riding ${Date.now()}`;
  await newWorkspace(page, name);
  // The bike, the wanted pedals and two guides, the first scripting the moves the fake proposes.
  await startSaving(
    page,
    [
      "thing add: name Boardman MHT 8.6 | status have",
      "thing add: name Pedals | status have | brand Wellgo alloy flats | part of T1",
      "thing add: name DMR V8 pedals | status want",
      "save document",
      "# MTB journey guide",
      "",
      "Where I am, and what's next.",
      "",
      JOURNEY,
      PEDALS,
      DAY_ONE,
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await startSaving(
    page,
    ["save document", "# Day one guide", "", "Shop today, ride tomorrow."].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  // Written once Home asks for it, nobody waiting: it's Home the next time Home looks.
  const title = page.getByRole("heading", { level: 2, name: "Move 3 things where they belong" });
  await expect(async () => {
    await page.reload();
    await expect(title).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("Your guides, sorted")).toBeVisible();
  const moves = page.getByRole("list", { name: "Moves" });
  await expect(moves.getByRole("checkbox")).toHaveCount(3);
  for (const each of await moves.getByRole("checkbox").all()) await expect(each).toBeChecked();
  await expect(moves).toContainText(
    "MTB journey guide → a projectRide red trails with confidence: skills as its steps, next up as Next",
  );
  await expect(page.getByRole("button", { name: "Move 3" })).toBeVisible();
  await expect(page.getByText("Untick any to leave as it is · each move has Undo")).toBeVisible();
  // In place of the projects: there are none until it's done.
  await expect(page.getByRole("region", { name: "Projects" })).toHaveCount(0);
  // The frame round it is drawn before the board's shot.
  await expect(page.getByRole("button", { name: "Talk", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Talk or type to start a session…")).toBeVisible();
  await shot(page, "p3-move-review");

  // The day one guide stays where it is.
  await moves.getByRole("checkbox", { name: "Day one guide → archive" }).uncheck();
  await page.getByRole("button", { name: "Move 2" }).click();

  // Home is itself again: the journey is a project, with its next step.
  const projects = page.getByRole("region", { name: "Projects" });
  await expect(projects).toContainText("Ride red trails with confidence");
  await expect(projects).toContainText("Next: The cornering drill on Saturday's ride");
  await expect(title).toHaveCount(0);
  await shot(page, "p3-after-move");
  // Only the day one guide is left among the documents.
  await openTab(page, "Docs");
  await expect(page.getByRole("region", { name: "Documents" })).toContainText("Day one guide");
  await expect(page.getByRole("region", { name: "Documents" })).not.toContainText("MTB journey");

  // Each move is a change in Recent changes, with Undo.
  await openTab(page, "Home");
  await openWhatCourtyardKnows(page);
  await page.getByRole("link", { name: "Recent changes" }).click();
  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes).toContainText("MovedPayday upgrade list → upcoming parts");
  await expect(changes).toContainText("MovedMTB journey guide → a project");
  await shot(page, "p3-moves-in-recent-changes");
});
