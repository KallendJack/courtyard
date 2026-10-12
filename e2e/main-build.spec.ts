import { expect, type Locator, type Page, test } from "@playwright/test";
import { themeColour } from "./theme.ts";

// Main's build beside Update (#249): one bar per CI job, violet running, moss passed, red failed,
// and Update offered only once the newest main has passed. The worker asks GitHub for it
// (live.test.ts); here the page is given each state of main's build as the worker gives it.

/** CI's jobs on main, in the order the workflow starts them. */
const JOBS = ["Checks", "Unit tests", "E2E 1/4", "E2E 2/4", "E2E 3/4", "E2E 4/4"];
type Outcome = "running" | "passed" | "failed";

const jobs = (outcomes: readonly Outcome[]) =>
  JOBS.map((name, i) => ({ name, outcome: outcomes[i] ?? "passed" }));

const RUNNING: readonly Outcome[] = ["passed", "running"];
const FAILED: readonly Outcome[] = ["passed", "failed", "passed", "running"];
const DETAILS = "https://github.com/octo-owner/courtyard/actions/runs/1/job/11";

const buildOf = (state: "running" | "passed" | "failed") => {
  switch (state) {
    case "running":
      // Due to end in two minutes, from how long the build before took.
      return {
        kind: state,
        jobs: jobs(RUNNING),
        endsAround: new Date(Date.now() + 2 * 60_000 - 5_000).toISOString(),
      };
    case "passed":
      return { kind: state, jobs: jobs([]) };
    case "failed":
      return { kind: state, jobs: jobs(FAILED), details: DETAILS };
  }
};

type State = Parameters<typeof buildOf>[0];

/** The live copy's status, a version behind main, with main's build in `state` each time it's asked. */
const withMainBuild = (page: Page, state: State | (() => State)) =>
  page.route("**/api/live", (route) =>
    route.fulfill({
      json: {
        kind: "live",
        running: { commit: "a".repeat(40), title: "a1b2c3d The running version" },
        newest: { commit: "7d518cd".padEnd(40, "0"), title: "7d518cd Rail and Talk key" },
        newerOnMain: true,
        lastUpdate: null,
        build: buildOf(typeof state === "function" ? state() : state),
      },
    }),
  );

/** Each job's name (with how it's going, for screen readers), in order. */
const jobsSaid = (outcomes: readonly Outcome[]) =>
  jobs(outcomes).map((job) => `${job.name}: ${job.outcome}`);

/** Each job's bar colour, as the browser draws it, in order. */
const barColours = (card: Locator) =>
  card
    .getByRole("list", { name: "Main's build" })
    .getByRole("listitem")
    .evaluateAll((items) =>
      items.map((item) => getComputedStyle(item.firstElementChild ?? item).backgroundColor),
    );

/** The theme's colour for each outcome. */
const coloursOf = async (page: Page, outcomes: readonly Outcome[]) => {
  const colours = {
    running: await themeColour(page, "primary"),
    passed: await themeColour(page, "success"),
    failed: await themeColour(page, "destructive"),
  };
  return jobs(outcomes).map((job) => colours[job.outcome]);
};

test("while main's build runs, each job shows its bar, and Update waits for it", async ({
  page,
}) => {
  await withMainBuild(page, "running");
  await page.goto("/");
  const card = page.getByRole("region", { name: "New version" });

  await expect(card).toContainText("Rail and Talk key 7d518cd");
  await expect(card.getByRole("status")).toHaveText("Unit tests · about 2 min");
  await expect(card.getByRole("listitem")).toHaveText(jobsSaid(RUNNING));
  expect(await barColours(card)).toEqual(await coloursOf(page, RUNNING));
  await expect(card.getByRole("button", { name: "Update" })).toBeDisabled();
});

test("once main's build has passed, Update is offered", async ({ page }) => {
  await withMainBuild(page, "passed");
  await page.goto("/");
  const card = page.getByRole("region", { name: "New version" });

  await expect(card.getByRole("status")).toHaveText("Passed");
  await expect(card.getByRole("listitem")).toHaveText(jobsSaid([]));
  expect(await barColours(card)).toEqual(await coloursOf(page, []));
  await expect(card.getByRole("button", { name: "Update" })).toBeEnabled();
});

test("when main's build has failed, Update waits, and Details opens the failed job's log", async ({
  page,
}) => {
  await withMainBuild(page, "failed");
  await page.goto("/");
  const card = page.getByRole("region", { name: "New version" });

  await expect(card.getByRole("status")).toHaveText("Unit tests failed");
  await expect(card.getByRole("listitem")).toHaveText(jobsSaid(FAILED));
  expect(await barColours(card)).toEqual(await coloursOf(page, FAILED));
  await expect(card.getByRole("button", { name: "Update" })).toHaveCount(0);
  const details = card.getByRole("link", { name: "Details" });
  await expect(details).toHaveAttribute("href", DETAILS);
  await expect(details).toHaveAttribute("target", "_blank");
});

test("the page asks again while main's build runs, and offers Update once it passes", async ({
  page,
}) => {
  await page.clock.install();
  let state: State = "running";
  await withMainBuild(page, () => state);
  await page.goto("/");
  const card = page.getByRole("region", { name: "New version" });
  await expect(card.getByRole("button", { name: "Update" })).toBeDisabled();

  state = "passed";
  await page.clock.runFor(16_000);

  await expect(card.getByRole("status")).toHaveText("Passed");
  await expect(card.getByRole("button", { name: "Update" })).toBeEnabled();
});

test.describe("on a tablet", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("Settings shows main's build beside Update", async ({ page }) => {
    await withMainBuild(page, "running");
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Settings" }).click();
    const card = page.getByRole("dialog", { name: "Settings" }).getByRole("region", {
      name: "Updates",
    });

    await expect(card.getByRole("status")).toHaveText("Unit tests · about 2 min");
    await expect(card.getByRole("listitem")).toHaveText(jobsSaid(RUNNING));
    await expect(card.getByRole("button", { name: "Update" })).toBeDisabled();
  });
});
