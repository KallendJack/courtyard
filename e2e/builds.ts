import { expect, type Page } from "@playwright/test";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";

// A Build opened in Fabrication, as fabrication.spec.ts and at-the-bench.spec.ts set one up.

export const STEP = "Build the workbench";

/** The golden bench, as its step's Build. Not "Workbench": its tile on Home would then match home.spec's seeded Workbench tile. */
export const SPLIT_BENCH = {
  name: "Split bench",
  template: "framed-bench",
  parameters: goldenBench,
};

/**
 * A workspace with a project whose first step owns a Build (the golden bench unless another is
 * given), made as the model makes them: the project in one session, then the Build given to its
 * step in another. Ends on its Home.
 */
export const workspaceWithBuild = async (
  page: Page,
  build: { name: string; template: string; parameters: unknown } = SPLIT_BENCH,
) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    `project: ${JSON.stringify({
      name: "Split the garage",
      add_steps: [{ who: "you", text: STEP }],
    })}`,
  );
  await expect(page.getByRole("list", { name: "Projects saved" })).toContainText("Started project");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  // On Home with its project before the next message, so it isn't typed into the session left.
  await expect(page.getByRole("region", { name: "Projects" })).toContainText("Split the garage");
  await startSaving(page, `build: ${JSON.stringify({ ...build, project: "P1", step: "s1" })}`);
  await expect(page.getByRole("list", { name: "Builds saved" })).toContainText("Started Build");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  return name;
};

/** From Home, the project's page, and its step's Open in Fabrication, to the Build `name` at `slug`. */
export const openInFabrication = async (page: Page, name = "Split bench", slug = "split-bench") => {
  await page
    .getByRole("region", { name: "Projects" })
    .getByRole("link", { name: "Split the garage" })
    .click();
  await page
    .getByRole("region", { name: "Next" })
    .getByRole("link", { name: "Open in Fabrication" })
    .click();
  // Your tools comes first while the owner has none saved (your-tools.spec.ts).
  const built = page.getByRole("heading", { level: 1, name });
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(built.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(page).toHaveURL(new RegExp(`/fabrication/workspaces/[^/]+/builds/${slug}$`));
  await expect(built).toBeVisible();
};
