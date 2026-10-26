import { expect, type Page, test } from "@playwright/test";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";

// Your stock (#760; Paper, 2 · Agreed, "Fabrication · Buy list with Have it · Fold"): Have it on a
// buy-list line saves it to Your stock, for every Build, and it drops off the list, with Undo.
// Your stock is the owner's, shared by every test's Builds, so this one's screws have a name of
// their own, and Undo leaves it as it was.

const UNFOLDED = { width: 933, height: 645 };

/** The golden bench, its frame screws a name no other test's Build has. */
const screws = `5 × 80 screws, run ${Date.now()}`;
const bench = {
  name: "Stock bench",
  template: "framed-bench",
  parameters: {
    ...goldenBench,
    fixings: {
      ...goldenBench.fixings,
      frameScrews: { ...goldenBench.fixings.frameScrews, name: screws },
    },
  },
};

/** A workspace whose project's step owns the bench, open in Fabrication on its buy list. */
const buyListOpen = async (page: Page) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    `project: ${JSON.stringify({ name: "Fit out", add_steps: [{ who: "you", text: "Build it" }] })}`,
  );
  await expect(page.getByRole("list", { name: "Projects saved" })).toContainText("Started project");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Projects" })).toContainText("Fit out");
  await startSaving(page, `build: ${JSON.stringify({ ...bench, project: "P1", step: "s1" })}`);
  await expect(page.getByRole("list", { name: "Builds saved" })).toContainText("Started Build");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page
    .getByRole("region", { name: "Projects" })
    .getByRole("link", { name: "Fit out" })
    .click();
  await page
    .getByRole("region", { name: "Next" })
    .getByRole("link", { name: "Open in Fabrication" })
    .click();
  const built = page.getByRole("heading", { level: 1, name: bench.name });
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(built.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(built).toBeVisible();
  await page.locator("label", { has: page.getByRole("radio", { name: "Plan" }) }).click();
  await page.getByRole("tab", { name: "Buy list" }).click();
  return page.getByRole("region", { name: "Buy list" });
};

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: UNFOLDED, hasTouch: true, isMobile: true });

  test("Have it takes a line off the buy list, and Undo puts it back", async ({ page }) => {
    const buyList = await buyListOpen(page);
    await expect(buyList.getByRole("heading", { name: "11 things left" })).toBeVisible();
    await expect(buyList).toContainText("Total £177.02");
    const have = buyList.getByRole("button", { name: `Have it: ${screws}` });

    await have.click();

    await expect(buyList.getByRole("heading", { name: "10 things left" })).toBeVisible();
    await expect(have).toHaveCount(0);
    await expect(buyList).toContainText("Total £171.82");
    const had = buyList.getByRole("region", { name: "You have" });
    await expect(had).toContainText(`You have 1 · ${screws}`);
    await had.getByRole("button", { name: "Show" }).click();
    await expect(had.getByRole("listitem")).toHaveText([`${screws}32 used`]);

    await buyList.getByRole("button", { name: "Undo" }).click();

    await expect(buyList.getByRole("heading", { name: "11 things left" })).toBeVisible();
    await expect(have).toBeVisible();
    await expect(buyList.getByRole("region", { name: "You have" })).toHaveCount(0);
  });
});
