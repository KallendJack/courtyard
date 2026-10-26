import { expect, type Page, test } from "@playwright/test";
import { BuildOpened } from "../packages/contract/index.ts";
import { openInFabrication, workspaceWithBuild } from "./builds.ts";

// At the bench as its agreed boards have it (#826; Paper, 2 · Agreed, "Fabrication · End frames
// in 3D, your kit · Fold (#785, #788)", "· Castors in 3D, your kit · Fold (#783)" and "· Asking at
// the bench: step buttons + answer card · Fold (#793)"): the step panel holds the step and its
// time, its title, its lines with their boxes, its tools as chips, the four step buttons, and Back
// and Done, and never scrolls on the unfolded Fold. Each step the boards draw is kept as a
// picture, for the side by side.

/** The steps the boards draw, by their ids. */
const DRAWN = ["end-frames", "fit-castors", "stand-on-bases"];

/** The Build's steps as the worker works them out. */
const stepsOf = async (page: Page) => {
  const api = new URL(page.url()).pathname.replace(/^\/fabrication/, "/api/fabrication");
  return BuildOpened.parse(await (await page.request.get(api)).json()).derived.steps;
};

/** The step panel's own scroller, and whether it has more than it shows. */
const overflows = (page: Page) =>
  page.getByRole("region", { name: "Steps" }).evaluate((steps) => {
    const box = steps.querySelector("[data-step-panel]");
    if (box === null) throw new Error("No step panel.");
    return box.scrollHeight > box.clientHeight;
  });

for (const [fold, viewport] of [
  ["unfolded", { width: 933, height: 645 }],
  ["folded", { width: 476, height: 695 }],
] as const) {
  test.describe(`on the ${fold} Fold`, () => {
    test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

    test("each step is what its board has, and nothing else", async ({ page }) => {
      test.setTimeout(180_000);
      // Courtyard's Home is set up open; the Build is then read at this size.
      await workspaceWithBuild(page);
      await openInFabrication(page);
      await page.setViewportSize(viewport);
      const steps = await stepsOf(page);
      const panel = page.getByRole("region", { name: "Steps" });
      const done = page.getByRole("button", { name: /^Done, / });
      for (const step of steps) {
        await expect(panel.getByRole("heading", { name: step.title })).toBeVisible();
        if (DRAWN.includes(step.id)) {
          // The picture settled, for the side by side with its board.
          await page.waitForTimeout(500);
          await page.screenshot({ path: `test-results/bench-boards/${step.id}-${fold}.png` });
        }
        // Only what the board has: no walk-through, batch line, fixings, numbers switch or hint.
        // Soft, so every step's differences are said at once.
        const soft = expect.configure({ soft: true, timeout: 1000 });
        for (const gone of ["How it's done", "Before you move on", "How you'll do it"]) {
          await soft(panel.getByRole("region", { name: gone }), step.id).toHaveCount(0);
        }
        await soft(panel.getByRole("button", { name: "Just the numbers" }), step.id).toHaveCount(0);
        await soft(panel, step.id).not.toContainText("Fixings:");
        await soft(panel, step.id).not.toContainText(step.batch);
        await soft(page.getByText(/^Swipe for the next step/), step.id).toHaveCount(0);
        await soft(
          panel.getByRole("list", { name: "Checklist" }).getByRole("listitem"),
          step.id,
        ).toHaveCount(step.actions.length);
        soft(step.actions.length, `${step.id}: at most 4 lines`).toBeLessThanOrEqual(4);
        // Open, the panel never scrolls; Back and Done are always in sight.
        if (fold === "unfolded") soft(await overflows(page), `${step.id} scrolls`).toBe(false);
        await soft(page.getByRole("button", { name: "Back" }), step.id).toBeInViewport();
        await soft(done, step.id).toBeInViewport();
        if (step.number < steps.length) await done.click();
      }
    });
  });
}
