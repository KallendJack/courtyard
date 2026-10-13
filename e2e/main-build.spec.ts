import { expect, type Page, test } from "@playwright/test";
import { themeColour } from "./theme.ts";

// Main's build beside Update (#249), in stages from the workflow's own order (#337): a compact
// row with a small graph and how long it has run, which opens the full graph; each job's dot
// violet running, moss passed, red failed, grey waiting; and Update offered only once the newest
// main has passed. The worker reads it from GitHub (live.test.ts); here the page is given each
// state of main's build as the worker gives it.

/** When the page's clock starts: main's build started 1 min 24 s before. */
const NOW = Date.parse("2026-10-13T10:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

type Outcome = "waiting" | "running" | "passed" | "failed" | "other";

/** A job's row, as the worker gives it. */
const job = (
  name: string,
  outcome: Outcome,
  more: { took?: number; shards?: { done: number; total: number }; needs?: string[] } = {},
) => ({
  name,
  outcome,
  startedAt: outcome === "waiting" ? null : ago(84),
  completedAt: outcome === "running" || outcome === "waiting" ? null : ago(84 - (more.took ?? 26)),
  shards: more.shards ?? null,
  needs: more.needs ?? [],
});

/** Courtyard's CI: three jobs side by side, the browser tests in four shards. */
const ciStages = (outcomes: { checks: Outcome; unit: Outcome; e2e: Outcome }, done = 1) => [
  [
    job("Checks", outcomes.checks),
    job("Unit tests", outcomes.unit, { took: 70 }),
    job("E2E", outcomes.e2e, { took: 80, shards: { done, total: 4 } }),
  ],
];

const DETAILS = "https://github.com/octo-owner/courtyard/actions/runs/1/job/11";

const buildOf = (state: "running" | "late" | "passed" | "failed" | "waits") => {
  switch (state) {
    case "running":
      // Due to end in two minutes, from how long each job usually takes.
      return {
        kind: "running",
        stages: ciStages({ checks: "passed", unit: "running", e2e: "running" }),
        startedAt: ago(84),
        endsAround: new Date(NOW + 2 * 60_000 - 5_000).toISOString(),
      };
    case "late":
      // Its jobs have run longer than they usually do.
      return {
        kind: "running",
        stages: ciStages({ checks: "passed", unit: "passed", e2e: "running" }, 3),
        startedAt: ago(84),
        endsAround: ago(10),
      };
    case "passed":
      return {
        kind: "passed",
        stages: ciStages({ checks: "passed", unit: "passed", e2e: "passed" }, 4),
        startedAt: ago(171),
        completedAt: ago(0),
      };
    case "failed":
      return {
        kind: "failed",
        stages: ciStages({ checks: "passed", unit: "failed", e2e: "running" }),
        details: DETAILS,
      };
    case "waits":
      // Another repository's workflow: a preview waits on lint and build, the browser tests on it.
      return {
        kind: "running",
        stages: [
          [job("Lint", "passed"), job("Build", "passed", { took: 60 })],
          [job("Deploy preview", "running", { needs: ["Lint", "Build"] })],
          [job("E2E", "waiting", { needs: ["Deploy preview"] })],
        ],
        startedAt: ago(84),
        endsAround: null,
      };
  }
};

type State = Parameters<typeof buildOf>[0];

/** The live copy's status, a version behind main, with main's build in `state` each time it's asked. */
const withMainBuild = async (page: Page, state: State | (() => State)) => {
  // The time stands at NOW until a test moves it on; timers still run.
  await page.clock.setFixedTime(NOW);
  await page.route("**/api/live", (route) =>
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
};

/** Home's row for main's build, and the full graph it opens. */
const homeRow = async (page: Page, state: State | (() => State)) => {
  await withMainBuild(page, state);
  await page.goto("/");
  return page.getByRole("region", { name: "New version" });
};
const openGraph = async (page: Page, row: ReturnType<Page["getByRole"]>) => {
  await row.getByRole("button", { name: /Main's build/ }).click();
  return page.getByRole("dialog", { name: "Main's build" });
};

/** Each job, in the order the graph lists them. */
const jobsOf = (graph: ReturnType<Page["getByRole"]>) =>
  graph.getByRole("list", { name: "Main's build" }).getByRole("listitem");
/** Each job's name, with how it's going for screen readers, then whatever follows. */
const said = (...jobs: string[]) => jobs.map((each) => new RegExp(`^${each}(?![a-z])`));

test("while main's build runs, its row says for how long, counting, and Update waits", async ({
  page,
}) => {
  const row = await homeRow(page, "running");

  await expect(row).toContainText("Rail and Talk key 7d518cd");
  await expect(row.getByRole("status")).toHaveText("Running · 1:24");
  await page.clock.setFixedTime(NOW + 2_000);
  await expect(row.getByRole("status")).toHaveText("Running · 1:26");
  await expect(row.getByRole("button", { name: "Update" })).toBeDisabled();
});

test("tapping the row opens the full graph: each job in the workflow's order, its time counting", async ({
  page,
}) => {
  const row = await homeRow(page, "running");
  const graph = await openGraph(page, row);

  await expect(graph.getByRole("status")).toHaveText("Running · 1:24 · about 2 min left");
  await expect(jobsOf(graph)).toHaveText(
    said("Checks: passed", "Unit tests: running", "E2E: running"),
  );
  const e2e = graph.getByRole("listitem").filter({ hasText: "E2E" });
  await expect(e2e).toContainText("1 of 4 · 1:24");
  await expect(graph.getByRole("listitem").filter({ hasText: "Checks" })).toContainText("0:26");
  await page.clock.setFixedTime(NOW + 3_000);
  await expect(e2e).toContainText("1 of 4 · 1:27");
});

test("a job past how long it usually takes says it's nearly done", async ({ page }) => {
  const row = await homeRow(page, "late");
  const graph = await openGraph(page, row);

  await expect(graph.getByRole("status")).toHaveText("Running · 1:24 · nearly done");
});

test("a job waiting on others comes after them, grey and dashed", async ({ page }) => {
  const row = await homeRow(page, "waits");
  const graph = await openGraph(page, row);

  await expect(jobsOf(graph)).toHaveText(
    said("Lint: passed", "Build: passed", "Deploy preview: running", "E2E: waiting"),
  );
  const waiting = graph.getByRole("listitem").filter({ hasText: "E2E" });
  await expect(waiting).toHaveCSS("border-top-style", "dashed");
  await expect(waiting).toHaveCSS("color", await themeColour(page, "placeholder"));
});

test("once main's build has passed, Update is offered, with how long it took", async ({ page }) => {
  const row = await homeRow(page, "passed");

  await expect(row.getByRole("status")).toHaveText("Passed · 2:51");
  await expect(row.getByRole("button", { name: "Update" })).toBeEnabled();
});

test("when main's build has failed, Update waits, and Details opens the failed job's log", async ({
  page,
}) => {
  const row = await homeRow(page, "failed");

  await expect(row.getByRole("status")).toHaveText("Unit tests failed");
  await expect(row.getByRole("button", { name: "Update" })).toHaveCount(0);
  const details = row.getByRole("link", { name: "Details" });
  await expect(details).toHaveAttribute("href", DETAILS);
  await expect(details).toHaveAttribute("target", "_blank");
  const graph = await openGraph(page, row);
  await expect(jobsOf(graph)).toHaveText(
    said("Checks: passed", "Unit tests: failed", "E2E: running"),
  );
});

test("the page asks again every 10 seconds while main's build runs, and offers Update once it passes", async ({
  page,
}) => {
  await page.clock.install({ time: NOW });
  let state: State = "running";
  const row = await homeRow(page, () => state);
  await expect(row.getByRole("button", { name: "Update" })).toBeDisabled();

  state = "passed";
  await page.clock.runFor(11_000);

  await expect(row.getByRole("status")).toHaveText("Passed · 2:51");
  await expect(row.getByRole("button", { name: "Update" })).toBeEnabled();
});

test.describe("on a tablet", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("Settings shows main's full graph beside Update", async ({ page }) => {
    await withMainBuild(page, "running");
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Settings" }).click();
    const card = page.getByRole("dialog", { name: "Settings" }).getByRole("region", {
      name: "Updates",
    });

    await expect(card.getByRole("status")).toHaveText("Running · 1:24 · about 2 min left");
    await expect(jobsOf(card)).toHaveText(
      said("Checks: passed", "Unit tests: running", "E2E: running"),
    );
    await expect(card.getByRole("button", { name: "Update" })).toBeDisabled();
  });
});
