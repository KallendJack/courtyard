import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Draw the garage from Home (#604; Paper, "2 · Agreed", planning workspace row: "Tablet · Garage
// Home: Draw the garage, then projects (#604)"): a planning workspace whose facts give a floor's
// two sides leads its Home with the space to draw, its size where the plan will be and what a plan
// is drawn from, as saved; Draw the garage, named from the workspace, starts a session holding
// those measurements; once a plan is drawn, Home shows it instead. The worker's side is in
// planning-home.test.ts.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** A plan of the garage, as a model draws one in an answer (#257). */
const PLAN = {
  room: "Garage",
  width: 274,
  depth: 514,
  front: "Garage door",
  openings: [{ kind: "garage-door", wall: "front", at: 20, width: 230 }],
  items: [{ name: "Desk", fromLeft: 40, fromBack: 0, width: 140, depth: 60 }],
};

/** The garage's facts as the owner saved them: two that measure it, one that doesn't. */
const withFacts = async (page: Page, name: string, cover = false) => {
  await newWorkspace(page, name);
  // On the cover screen the box opens with Type.
  if (cover) await page.getByRole("button", { name: "Type" }).tap();
  await startSaving(
    page,
    [
      "save fact: The garage is 5.14 × 2.74 m inside.",
      "save fact: It's 2.45 m high.",
      "save fact: The boiler is in the back corner.",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  await page.getByRole("link", { name: `Back to ${name}` }).click();
};

const drawCard = (page: Page, space: string) =>
  page.getByRole("region", { name: `No plan of the ${space} yet` });

test.describe("on the unfolded Fold", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("Draw the garage starts a session holding the measurements, and a plan drawn shows on Home in its place", async ({
    page,
  }) => {
    const name = `Garage ${Date.now()}`;
    const space = name.toLowerCase();
    await withFacts(page, name);

    // Where the plan will be, with its size, and everything it's drawn from, as saved.
    const card = drawCard(page, space);
    await expect(card).toBeVisible();
    await expect(card).toContainText("5.14 m × 2.74 m");
    await expect(card).toContainText(
      "Courtyard draws it to scale from what's saved: The garage is 5.14 × 2.74 m inside. It's 2.45 m high.",
    );
    await expect(card).not.toContainText("boiler");
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await shot(page, "draw-the-garage-fold");

    await card.getByRole("button", { name: `Draw the ${space}` }).tap();

    const session = page.getByRole("list", { name: "Session" });
    await expect(session).toContainText(
      `Draw the ${space} as a floor plan, to scale, from what's saved:`,
    );
    await expect(session).toContainText("The garage is 5.14 × 2.74 m inside.");
    await expect(session).toContainText("It's 2.45 m high.");
    await expect(session).toContainText(/Your turn · finished/);

    // A plan drawn in an answer is the garage's subject from then on.
    await page.getByRole("link", { name: `Back to ${name}` }).click();
    await startSaving(page, `Here it is:\n\n\`\`\`plan\n${JSON.stringify(PLAN)}\n\`\`\`\n`);
    await expect(session).toContainText(/Your turn · finished/);
    await page.getByRole("link", { name: `Back to ${name}` }).click();
    await expect(page.getByRole("figure", { name: "Garage floor plan" })).toBeVisible();
    await expect(drawCard(page, space)).toHaveCount(0);
  });
});

test.describe("on the cover screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 900 } });

  test("the space to draw stacks, its size above what it's drawn from, Draw the garage under it", async ({
    page,
  }) => {
    const name = `Garage ${Date.now()}`;
    const space = name.toLowerCase();
    await withFacts(page, name, true);

    const card = drawCard(page, space);
    await expect(card.getByRole("button", { name: `Draw the ${space}` })).toBeVisible();
    const box = await card.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(400);
    await shot(page, "draw-the-garage-cover");
  });
});
