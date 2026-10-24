import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  type BuilderStatus,
  builderHash,
  CodeSessionList,
  LeadStatus,
  NeedsYou,
  NextUp,
  SessionId,
} from "../packages/contract/index.ts";
import { shiftsOn } from "./shifts.ts";

// The Builders board (#592; Paper, "2 · Agreed", code workspace row: "Tablet · Builders board,
// running", "… waits on you, Stuck, limit", "Tablet · Home: builders in Needs you, the tile line",
// "Cover · Builders board, running"), on start-worker.mjs's Toolshed. The e2e builders only ask a
// question, so the Lead's status, the sessions and Next up are given here as the worker would give
// them; the worker's side is in lead.test.ts and builder-status.test.ts.

// Text measured as the Fold draws it (#690): Chromium on Linux, as in CI, hints its glyphs a pixel
// or two wider unless told not to, and the boards leave about that much.
test.use({
  viewport: { width: 950, height: 712 },
  hasTouch: true,
  isMobile: true,
  launchOptions: { args: ["--font-render-hinting=none"] },
});

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const HOME = "/workspaces/toolshed";
const API = "/api/workspaces/toolshed";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const from = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
/** A time as the page's clock shows it, in the browser's own locale. */
const clock = (page: Page, iso: string) =>
  page.evaluate(
    (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    iso,
  );

const LEAD = "0f1e2d3c-4b5a-4968-8776-655443322110";
const IDEAS = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const JOURNEY = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const NOTIFY = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const TALK = "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80";
const TILES = "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091";
const PINS = "6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f8091a2";

/** A builder session as Toolshed's list gives it. */
const listed = (id: string, issue: number, name: string, more: object = {}) => ({
  id,
  workspaceId: "toolshed",
  title: `Build #${issue}: ${name}`,
  createdAt: ago(90),
  updatedAt: ago(1),
  busy: false,
  byLead: true,
  now: { kind: "your-turn" },
  waiting: "nothing",
  queued: false,
  branch: `courtyard/${id.slice(0, 8)}`,
  ...more,
});

const working = (doing: object) => ({
  busy: true,
  now: { kind: "working", since: ago(3), doing },
});

/** One of the Lead's builders with its status. */
const builder = (session: string, issue: number, name: string, status: BuilderStatus) => ({
  session,
  title: `Build #${issue}: ${name}`,
  issue,
  status,
});

const issue = (number: number, title: string, ready = true) => ({
  number,
  title,
  url: `https://github.com/octo-owner/toolshed/issues/${number}`,
  milestone: "5 · Planning workspaces",
  ready,
  after: null,
});

/** Toolshed's Home as given: its Lead, its sessions and Next up; nothing else waits. */
const given = async (
  page: Page,
  state: { lead: object; sessions: object[]; issues?: object[] },
  /** How long the Lead's answer takes, so the board loads after the page. */
  leadAfterMs = 0,
) => {
  const lead = LeadStatus.parse({
    state: "running",
    session: LEAD,
    builders: 2,
    building: [],
    statuses: [],
    next: [],
    ready: [],
    toTidy: 0,
    ...state.lead,
  });
  const list = CodeSessionList.parse({ running: 0, sessions: state.sessions });
  const nextUp = NextUp.parse({ issues: state.issues ?? [] });
  await page.route(`**${API}/lead`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, leadAfterMs));
    await route.fulfill({ json: lead });
  });
  await page.route(`**${API}/sessions`, (route) => route.fulfill({ json: list }));
  await page.route(`**${API}/next-up`, (route) => route.fulfill({ json: nextUp }));
  await page.route(`**${API}/pull-requests`, (route) =>
    route.fulfill({ json: { pullRequests: [] } }),
  );
  // Connected, as on the boards, so no notice takes the blocks' room.
  await page.route(`**${API}/connections`, (route) =>
    route.fulfill({
      json: { github: { kind: "connected", repo: "octo-owner/toolshed" }, paper: { kind: "none" } },
    }),
  );
};

/** The board, and a builder's row on it by its issue's name. */
const board = (page: Page) => page.getByRole("region", { name: "Builders" });
const row = (page: Page, name: string) => board(page).getByRole("listitem", { name, exact: true });

const RUNNING = {
  lead: {
    building: [
      { session: IDEAS, title: "Build #41: Ideas, ranked by value", issue: 41 },
      { session: JOURNEY, title: "Build #42: Journey book", issue: 42 },
    ],
    statuses: [
      builder(IDEAS, 41, "Ideas, ranked by value", { kind: "building", since: ago(6) }),
      builder(JOURNEY, 42, "Journey book", {
        kind: "checking",
        since: ago(2),
        command: "pnpm -C apps/web exec vitest run src/history.test.ts",
        ahead: 1,
      }),
      builder(NOTIFY, 43, "Notify me", {
        kind: "ready-for-review",
        since: ago(20),
        pullRequest: 612,
      }),
    ],
    ready: [{ session: NOTIFY, title: "Build #43: Notify me", issue: 43, pullRequest: 612 }],
    next: [issue(44, "Sub-workspaces")],
  },
  sessions: [
    listed(IDEAS, 41, "Ideas, ranked by value", {
      ...working({ kind: "activity", activity: { kind: "edited-file", path: "ideas-card.tsx" } }),
    }),
    listed(JOURNEY, 42, "Journey book", { ...working({ kind: "thinking" }) }),
    listed(NOTIFY, 43, "Notify me"),
  ],
  issues: [issue(45, "Tidy, one shared piece", false), issue(44, "Sub-workspaces")],
};

test("the board's rows say each builder's status, since when and what it's doing, a button only where it acts", async ({
  page,
}) => {
  await given(page, RUNNING);
  await page.goto(HOME);

  await expect(board(page)).toContainText("2 of 2 building · 1 of 4 for review");
  await expect(board(page)).toContainText(
    "Runs all night · Sub-workspaces starts when a place frees",
  );
  await expect(board(page).getByRole("button", { name: "Pause" })).toBeVisible();

  const ideas = row(page, "Ideas, ranked by value");
  await expect(ideas).toContainText("Building · 6 min");
  await expect(ideas).toContainText("editing ideas-card.tsx");
  const journey = row(page, "Journey book");
  await expect(journey).toContainText("Checking · 2 min");
  await expect(journey).toContainText("history.test.ts · 2nd in line");
  const notify = row(page, "Notify me");
  await expect(notify).toContainText("Ready for review · 20 min");
  await expect(notify.getByRole("link", { name: "Review Notify me" })).toHaveAttribute(
    "href",
    /#pr-612$/,
  );
  // Only working, a row has no button: the whole row opens its session.
  await expect(ideas.getByRole("button")).toHaveCount(0);
  await expect(journey.getByRole("button")).toHaveCount(0);

  // A builder's pull request ready for review is on the board, not in Needs you too (#592).
  await expect(page.getByRole("region", { name: "Needs you" })).toContainText("Nothing needs you");
  // Under Grill, the next issue is simply Next while the Lead runs.
  await expect(
    page.getByRole("region", { name: "Next up" }).getByRole("region", { name: "Build #44" }),
  ).toContainText("Next");
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  await shot(page, "tablet-builders-board-running");

  await ideas.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/toolshed/sessions/${IDEAS}$`));
});

// Nothing moves once drawn (#283): the board holds its place, at its final size, while its Lead's
// answer comes late, on the Fold, the cover screen and a desktop.
for (const [screen, viewport] of [
  ["the unfolded Fold", { width: 950, height: 712 }],
  ["the cover screen", { width: 400, height: 900 }],
  ["a desktop", { width: 1440, height: 900 }],
] as const) {
  test(`the board loading late moves nothing, on ${screen}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await given(page, RUNNING, 600);
    const shifts = await shiftsOn(page, HOME, (opened) =>
      expect(row(opened, "Notify me")).toContainText("Ready for review"),
    );
    const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
    expect(total, JSON.stringify(shifts, null, 2)).toBeLessThan(0.001);
  });
}

/** Where a locator is drawn, top to bottom. */
const span = async (of: Locator) => {
  const drawn = await of.boundingBox();
  if (drawn === null) throw new Error("not drawn");
  return { top: drawn.y, bottom: drawn.y + drawn.height };
};

/** Running with nothing to build: no builders, nothing next. */
const IDLE = { state: "running" } as const;
/** Paused with no builders, two merges to tidy and Merge in order stopped (#591, #423). */
const STOPPED = {
  state: "paused",
  toTidy: 2,
  merge: { kind: "stopped", pullRequest: 612, why: "its e2e check failed" },
} as const;

// With no builders (#635), the board's one quiet line sits under its reasons line, inside the
// block, and nothing moves or overlaps: on the Fold, on the Fold with less room (the browser's bars,
// a bigger text size), and on the cover screen. With nothing building or for review, it has no
// counts (#646).
for (const [screen, viewport, name] of [
  ["the unfolded Fold", { width: 950, height: 712 }, "tablet-builders-board-empty"],
  [
    "the unfolded Fold with less room",
    { width: 950, height: 556 },
    "tablet-short-builders-board-empty",
  ],
  ["the cover screen", { width: 400, height: 900 }, "cover-builders-board-empty"],
] as const) {
  test(`with no builders, the board's empty line sits inside it, on ${screen}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await given(page, {
      lead: IDLE,
      sessions: [],
      issues: [issue(45, "Tidy, one shared piece", false)],
    });
    const empty = board(page).getByText("No builders right now");
    const shifts = await shiftsOn(page, HOME, () => expect(empty).toBeVisible());
    expect(shifts.reduce((sum, shift) => sum + shift.value, 0)).toBeLessThan(0.001);

    const reasons = board(page).getByText("Runs all night", { exact: true });
    await expect(reasons).toBeVisible();
    await expect(board(page)).not.toContainText("building");
    const block = await span(board(page));
    const line = await span(empty);
    const header = await span(reasons);
    const needs = await span(page.getByRole("region", { name: "Needs you" }));
    const main = await span(page.getByRole("region", { name: "Main" }));
    await shot(page, name);
    expect(line.top).toBeGreaterThanOrEqual(header.bottom);
    // Inside the block's padding, not on or past its edge.
    expect(line.bottom).toBeLessThanOrEqual(block.bottom - 14);
    // Needs you, under it, still ends above Main.
    expect(needs.top).toBeGreaterThanOrEqual(block.bottom);
    expect(needs.bottom).toBeLessThanOrEqual(main.top);
  });
}

test("paused with no builders, nothing runs: the board says so in one quiet line, with Run", async ({
  page,
}) => {
  await given(page, {
    lead: STOPPED,
    sessions: [],
    issues: [issue(45, "Tidy, one shared piece", false)],
  });
  await page.goto(HOME);

  const line = board(page).getByText(/^Not running · Run starts the next issue/);
  await expect(line).toHaveText(
    "Not running · Run starts the next issue · 2 merges to tidy · Merge in order stopped at #612: its e2e check failed",
  );
  await expect(line).toHaveClass(/text-muted-foreground/);
  await expect(board(page).getByRole("button", { name: "Run" })).toBeVisible();
  // No counts, no "builders carry on" with none, and no second line saying there are none.
  await expect(board(page)).not.toContainText("building");
  await expect(board(page)).not.toContainText("carry on");
  await expect(board(page)).not.toContainText("No builders right now");
  await shot(page, "tablet-builders-board-not-running");
});

/** Two pull requests a Claude Code helper opened, checks passed: two rows in Needs you. */
const READY_PULLS = [645, 644].map((number, at) => ({
  pullRequest: {
    number,
    title: `ADR ${number}: a rule of the house`,
    url: `https://github.com/octo-owner/toolshed/pull/${number}`,
    state: "open",
    head: `c0ffee${at}`,
    checks: { kind: "passed" },
    changes: { additions: 3, deletions: 1, files: 1 },
    conflicts: false,
  },
  branch: `helper-${number}`,
  from: { kind: "claude-code" },
  waiting: "merge",
}));

/** Both providers past 80%, as the worker warns them (#66): Fake at its limit, Fake two at 83%. */
const bothNearTheirLimits = () => {
  const resetAt = from(150);
  const warning = (provider: string, label: string, window: string, used: number) => ({
    provider,
    label,
    window,
    used,
    resetAt,
  });
  return {
    providers: [],
    warnings: [
      warning("fake-two", "Fake two", "weekly", 83),
      warning("fake", "Fake", "five-hour", 100),
    ],
  };
};

// No block is ever drawn over another, at any size (#646): the owner's case, a Fold with the
// browser's bars (the Builders board empty and paused, Needs you with two rows, both providers
// near their limits, Main), and shorter ones; then the Fold and the cover screen. A block too short
// for its rows scrolls them inside itself; where there's room, the board's last line sits whole
// inside it (#635).
for (const [screen, viewport, lead, roomy, name] of [
  ["the owner's Fold", { width: 950, height: 662 }, STOPPED, true, "spill-tablet-owner"],
  ["the owner's Fold, running", { width: 950, height: 662 }, IDLE, true, "spill-tablet-owner-idle"],
  ["the Fold with less room", { width: 950, height: 556 }, STOPPED, false, "spill-tablet-short"],
  [
    "the Fold with less room, running",
    { width: 950, height: 556 },
    IDLE,
    false,
    "spill-tablet-idle",
  ],
  [
    "the Fold with even less room",
    { width: 950, height: 480 },
    IDLE,
    false,
    "spill-tablet-shorter",
  ],
  ["the unfolded Fold", { width: 950, height: 712 }, IDLE, true, "spill-tablet-fold"],
  ["the cover screen", { width: 400, height: 900 }, STOPPED, true, "spill-cover"],
] as const) {
  test(`with both providers near their limits, nothing is drawn over another, on ${screen}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await given(page, {
      lead,
      sessions: [],
      issues: [issue(45, "Tidy, one shared piece"), issue(46, "Pin to Home")],
    });
    await page.route(`**${API}/pull-requests`, (route) =>
      route.fulfill({ json: { pullRequests: READY_PULLS } }),
    );
    const usage = bothNearTheirLimits();
    await page.route("**/api/usage**", (route) => route.fulfill({ json: usage }));
    // The status line under the name, as on the owner's screen: it takes some of the blocks' room.
    await page.route(`**${API}/status-line`, (route) =>
      route.fulfill({
        json: { done: { text: "Notifications" }, now: null, next: { text: "New workspace" } },
      }),
    );
    await page.goto(HOME);

    const needs = page.getByRole("region", { name: "Needs you" });
    const usageLine = page.getByRole("region", { name: "Usage" });
    const main = page.getByRole("region", { name: "Main" });
    const last = board(page).getByText(
      lead.state === "paused" ? /^Not running/ : "No builders right now",
    );
    await expect(needs.getByRole("listitem")).toHaveCount(2);
    // One usage row, whatever the providers (#646): the fullest first, with when it's back.
    await expect(usageLine).toHaveCount(1);
    await expect(usageLine).toContainText(
      /^UsageFake at its limit · back .+· Fake two 83% this week$/i,
    );
    await expect(main).toBeVisible();
    await expect(last).toBeVisible();
    await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
    // The frame, with the message box that takes the foot of the page, comes in after the page.
    await expect(page.getByRole("button", { name: /^Model: / })).toBeEnabled();
    await shot(page, name);

    // Each block in the column ends before the next begins, in the page's order.
    const order = [board(page), needs, usageLine, main];
    const spans = await Promise.all(order.map(span));
    for (const [at, below] of spans.slice(1).entries()) {
      expect(below.top, `block ${at + 1} under block ${at}`).toBeGreaterThanOrEqual(
        spans[at]?.bottom ?? Number.POSITIVE_INFINITY,
      );
    }
    // What's drawn near each block's top, at its middle and near its foot is its own: nothing of
    // another block is drawn over it.
    for (const block of order) {
      await block.scrollIntoViewIfNeeded();
      const ownsItsArea = await block.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [box.top + 4, box.top + box.height / 2, box.bottom - 4].every((y) => {
          const drawn = document.elementFromPoint(box.left + box.width / 2, y);
          return drawn !== null && element.contains(drawn);
        });
      });
      expect(ownsItsArea, (await block.getAttribute("aria-label")) ?? "a block").toBe(true);
    }
    // With room, the board's last line sits whole inside it, clear of its edge (#635).
    if (roomy) {
      expect((await span(last)).bottom).toBeLessThanOrEqual((await span(board(page))).bottom - 14);
    }
  });
}

// One Run, in one place (#648): a Lead that has never run and one paused with no builders show
// the same board, Run and one quiet line. Run on the first shows what the Lead does before it
// starts; on the second it starts straight away. Next up has no Run of its own.
for (const [never, lead] of [
  [true, { state: "not-started" }],
  [false, { state: "paused" }],
] as const) {
  test(`with nothing running, the board has Run and one quiet line, ${never ? "never run" : "run before"}`, async ({
    page,
  }) => {
    await given(page, { lead, sessions: [], issues: [issue(45, "Tidy, one shared piece")] });
    // Once run, the Lead runs, with no builders yet.
    const runs: unknown[] = [];
    const running = LeadStatus.parse({
      state: "running",
      session: LEAD,
      builders: 2,
      building: [],
      statuses: [],
      next: [],
      ready: [],
      toTidy: 0,
    });
    await page.route(`**${API}/lead/run`, async (route) => {
      runs.push(route.request().postDataJSON());
      await route.fulfill({ json: running });
    });
    await page.route(`**${API}/lead`, (route) =>
      runs.length === 0 ? route.fallback() : route.fulfill({ json: running }),
    );
    await page.goto(HOME);

    const header = board(page).getByText("Not running · Run starts the next issue", {
      exact: true,
    });
    await expect(header).toBeVisible();
    await expect(board(page)).not.toContainText("building");
    await expect(board(page)).not.toContainText("No builders");
    await expect(board(page)).not.toContainText("Paused");
    const nextUp = page.getByRole("region", { name: "Next up" });
    await expect(nextUp.getByRole("button", { name: "Build" })).toBeVisible();
    await expect(nextUp.getByRole("button", { name: /Run/ })).toHaveCount(0);
    await shot(
      page,
      never ? "tablet-builders-board-never-run" : "tablet-builders-board-run-before",
    );

    await board(page).getByRole("button", { name: "Run" }).click();
    const dialog = page.getByRole("dialog", { name: "Run", exact: true });
    if (never) {
      await expect(dialog).toContainText("The Lead runs the build order");
      await expect(dialog).toContainText("beginning with #45 Tidy, one shared piece");
      expect(runs).toHaveLength(0);
      await shot(page, "tablet-builders-board-run-explained");
      await dialog.getByRole("button", { name: "Run" }).click();
      await expect(dialog).toBeHidden();
    } else {
      await expect(dialog).toHaveCount(0);
    }
    await expect.poll(() => runs.length).toBe(1);
    await expect(board(page).getByRole("button", { name: "Pause" })).toBeVisible();
  });
}

test("on the cover screen, the board comes first, then Needs you, then Next up", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 900 });
  await given(page, RUNNING);
  await page.goto(HOME);
  await expect(row(page, "Notify me")).toContainText("Ready for review");
  const builders = await board(page).boundingBox();
  const needs = await page.getByRole("region", { name: "Needs you" }).boundingBox();
  expect(builders?.y ?? 0).toBeLessThan(needs?.y ?? 0);
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  await shot(page, "cover-builders-board-running");
});

test("a builder's notification opens Home with its row on the board in view (#593)", async ({
  page,
}) => {
  // On the cover screen the board is three rows tall: the sixth is out of view until asked for.
  await page.setViewportSize({ width: 400, height: 900 });
  const six = [
    [IDEAS, 41, "Ideas, ranked by value"],
    [JOURNEY, 42, "Journey book"],
    [NOTIFY, 43, "Notify me"],
    [TALK, 47, "Hold to talk"],
    [TILES, 48, "Tiles that fit"],
    [PINS, 49, "Pin to Home"],
  ] as const;
  await given(page, {
    lead: {
      statuses: six.map(([session, number, name]) =>
        builder(
          session,
          number,
          name,
          session === PINS
            ? { kind: "stuck", since: ago(2), reason: "A restart cut its turn off twice." }
            : { kind: "building", since: ago(10) },
        ),
      ),
    },
    sessions: six.map(([session, number, name]) => listed(session, number, name)),
  });
  const pins = row(page, "Pin to Home");

  await page.goto(HOME);
  await expect(pins).toContainText("Stuck");
  await expect(pins).not.toBeInViewport();

  // The page its notification opens, as the worker names it.
  await page.goto("about:blank");
  await page.goto(`${HOME}#${builderHash(SessionId.parse(PINS))}`);

  await expect(pins).toBeInViewport({ ratio: 1 });
  await expect(pins.getByRole("button", { name: "Retry Pin to Home" })).toBeVisible();
});

test("the header lists every reason the Lead starts no more; Allow and Retry act in their rows", async ({
  page,
}) => {
  const resetAt = from(40);
  await given(page, {
    lead: {
      statuses: [
        builder(JOURNEY, 42, "Journey book", {
          kind: "waiting-on-you",
          since: ago(3),
          approval: 7,
        }),
        builder(IDEAS, 41, "Ideas, ranked by value", {
          kind: "stuck",
          since: ago(60),
          reason: "It ended two turns in a row with no pull request and no question.",
        }),
        builder(NOTIFY, 43, "Notify me", { kind: "waiting-for-limit", since: ago(40), resetAt }),
      ],
      holding: [{ kind: "limit", until: resetAt }],
      heldBack: [{ issue: 46, behind: 42 }],
    },
    sessions: [
      listed(JOURNEY, 42, "Journey book", {
        busy: true,
        now: {
          kind: "needs-you",
          since: ago(3),
          ask: { kind: "command", command: "gh pr checks --watch", reason: "off-allowlist" },
          approval: 7,
        },
        waiting: "approval",
      }),
      listed(IDEAS, 41, "Ideas, ranked by value", {
        waiting: "stuck",
        stuck: "It ended two turns in a row with no pull request and no question.",
      }),
      listed(NOTIFY, 43, "Notify me"),
    ],
    issues: [issue(46, "Pin to Home")],
  });
  const allowed: string[] = [];
  await page.route(`**/api/sessions/${JOURNEY}/approvals/7`, async (route) => {
    allowed.push(route.request().postData() ?? "");
    await route.fulfill({ json: { answer: "allow" } });
  });
  let retried = 0;
  await page.route(`**/api/sessions/${IDEAS}/retry`, async (route) => {
    retried += 1;
    await route.fulfill({ status: 202, body: "" });
  });
  await page.goto(HOME);

  // Two reasons at once, never only the first.
  await expect(board(page)).toContainText(
    `Not starting more: the usage limit, until ${await clock(page, resetAt)} · Pin to Home waits for Journey book to merge`,
  );
  const journey = row(page, "Journey book");
  await expect(journey).toContainText("Waiting on you · 3 min");
  await expect(journey).toContainText("wants to run gh pr checks --watch");
  const ideas = row(page, "Ideas, ranked by value");
  await expect(ideas).toContainText("Stuck · 1 h");
  await expect(ideas).toContainText("It ended two turns in a row");
  const notify = row(page, "Notify me");
  await expect(notify).toContainText("Waiting for the limit · 40 min");
  await expect(notify).toContainText(`carries on at ${await clock(page, resetAt)}`);
  await expect(notify.getByRole("button")).toHaveCount(0);
  // What waits for a merge says so in Next up too, in the same words (Held back goes).
  await expect(page.getByRole("region", { name: "Next up" })).toContainText(
    "Next · waits for Journey book to merge",
  );
  // The builders that need the owner are on the board only: Needs you holds the rest.
  await expect(page.getByRole("region", { name: "Needs you" })).toContainText(
    "Nothing else needs you",
  );
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  await shot(page, "tablet-builders-board-waits-on-you-stuck-limit");

  await journey
    .getByRole("button", { name: "Allow: Journey book wants to run gh pr checks --watch" })
    .click();
  await expect.poll(() => allowed).toEqual([JSON.stringify({ answer: "allow" })]);
  await ideas.getByRole("button", { name: "Retry Ideas, ranked by value" }).click();
  await expect.poll(() => retried).toBe(1);
});

// The build at the board's sizes (#690; Paper, "Tablet · Builders board, running", 950 × 712, and
// "Tablet · Code Home: approvals in Needs you, one bottom bar", 933 × 645): on the Fold open the
// board's three rows fit whole inside it, and on both the line under the name and the tabs beside
// it show the board's words whole. The boards leave a pixel or so, so the text is measured as the
// Fold draws it (the file's `test.use`).
for (const viewport of [
  { width: 950, height: 712 },
  { width: 933, height: 645 },
] as const) {
  test(`the Home at the boards' sizes, ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await given(page, RUNNING);
    await page.route(`**${API}/connections`, (route) =>
      route.fulfill({
        json: {
          github: { kind: "connected", repo: "owner/courtyard" },
          paper: { kind: "connected", fileId: "a-file", name: "a file" },
        },
      }),
    );
    await page.goto(HOME);
    await expect(row(page, "Notify me")).toContainText("Ready for review");
    // The frame's rails in, as the owner sees it, so the page has its own width.
    await expect(page.getByRole("button", { name: /^Model: / })).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    await shot(page, `tablet-home-at-board-size-${viewport.height}`);

    const line = page.getByRole("button", { name: /owner\/courtyard.*Paper · a file/ });
    await expect(line).toBeVisible();
    const cut = (of: Locator) =>
      of.evaluate((element) =>
        [element, ...element.querySelectorAll("*")]
          .filter((each) => each.scrollWidth > each.clientWidth)
          .map((each) => each.textContent),
      );
    await expect.poll(() => cut(line)).toEqual([]);
    await expect
      .poll(() => cut(page.getByRole("navigation", { name: "Workspace tabs" })))
      .toEqual([]);

    if (viewport.height === 712) {
      // Whole: none scrolled out of sight inside the board.
      await expect(board(page).locator("[data-overflows]")).toHaveCount(0);
      const block = await span(board(page));
      for (const name of ["Ideas, ranked by value", "Journey book", "Notify me"]) {
        const drawn = await span(row(page, name));
        expect(drawn.top, name).toBeGreaterThanOrEqual(block.top);
        expect(drawn.bottom, name).toBeLessThanOrEqual(block.bottom);
      }
    }
  });
}

test("a question is answered in its session; In CI and Merged today show, yesterday's merge has gone", async ({
  page,
}) => {
  await given(page, {
    lead: {
      state: "paused",
      statuses: [
        builder(TALK, 47, "Hold to talk", { kind: "waiting-on-you", since: ago(5) }),
        builder(TILES, 48, "Tiles that fit", { kind: "in-ci", since: ago(4), pullRequest: 613 }),
        builder(NOTIFY, 43, "Notify me", { kind: "merged", since: ago(1), pullRequest: 612 }),
        builder(IDEAS, 41, "Ideas, ranked by value", {
          kind: "merged",
          since: new Date(Date.now() - 36 * 60 * 60_000).toISOString(),
          pullRequest: 600,
        }),
      ],
    },
    sessions: [
      listed(TALK, 47, "Hold to talk", { waiting: "reply" }),
      listed(TILES, 48, "Tiles that fit"),
      listed(NOTIFY, 43, "Notify me"),
      listed(IDEAS, 41, "Ideas, ranked by value"),
    ],
  });
  await page.goto(HOME);

  await expect(board(page)).toContainText("Paused · builders carry on, nothing new starts");
  await expect(board(page).getByRole("button", { name: "Run" })).toBeVisible();
  await expect(row(page, "Tiles that fit")).toContainText("In CI · 4 min");
  await expect(row(page, "Tiles that fit")).toContainText("#613 · checks running");
  await expect(row(page, "Notify me")).toContainText("Merged");
  await expect(row(page, "Notify me")).toContainText("#612 merged");
  await expect(row(page, "Ideas, ranked by value")).toHaveCount(0);
  const talk = row(page, "Hold to talk");
  await expect(talk).toContainText("Waiting on you · 5 min");
  await shot(page, "tablet-builders-board-answer-in-ci-merged");
  await talk.getByRole("link", { name: "Answer Hold to talk" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/toolshed/sessions/${TALK}$`));
});

test("Home's Needs you lists builders with Allow and Retry acting in place, and the tile says what they're doing", async ({
  page,
}) => {
  const resetAt = from(40);
  // Toolshed's tile: one waits on you, one is stuck, one is ready for review.
  await given(page, {
    lead: {
      statuses: [
        builder(JOURNEY, 42, "Journey book", {
          kind: "waiting-on-you",
          since: ago(3),
          approval: 7,
        }),
        builder(IDEAS, 41, "Ideas, ranked by value", {
          kind: "stuck",
          since: ago(60),
          reason: "stopped twice with no PR",
        }),
        builder(NOTIFY, 43, "Notify me", {
          kind: "ready-for-review",
          since: ago(20),
          pullRequest: 612,
        }),
      ],
      holding: [{ kind: "limit", until: resetAt }],
    },
    sessions: [
      listed(JOURNEY, 42, "Journey book"),
      listed(IDEAS, 41, "Ideas, ranked by value"),
      listed(NOTIFY, 43, "Notify me"),
    ],
  });
  const where = {
    workspace: { id: "toolshed", name: "Toolshed" },
    builder: true,
  };
  const needs = NeedsYou.parse({
    busy: false,
    needs: [
      {
        kind: "stuck",
        ...where,
        session: { id: IDEAS, title: "Build #41: Ideas, ranked by value" },
        since: ago(60),
        reason: "stopped twice with no PR",
      },
      {
        kind: "approval",
        ...where,
        session: { id: JOURNEY, title: "Build #42: Journey book" },
        since: ago(3),
        approval: {
          number: 7,
          ask: { kind: "command", command: "gh pr checks --watch", reason: "off-allowlist" },
        },
      },
      {
        kind: "merge",
        ...where,
        session: { id: NOTIFY, title: "Build #43: Notify me" },
        since: ago(20),
        pullRequest: { number: 612, title: "Notify me" },
      },
    ],
  });
  await page.route("**/api/needs-you", (route) => route.fulfill({ json: needs }));
  let allowed = 0;
  await page.route(`**/api/sessions/${JOURNEY}/approvals/7`, async (route) => {
    allowed += 1;
    await route.fulfill({ json: { answer: "allow" } });
  });
  let retried = 0;
  await page.route(`**/api/sessions/${IDEAS}/retry`, async (route) => {
    retried += 1;
    await route.fulfill({ status: 202, body: "" });
  });
  await page.goto("/");

  const block = page.getByRole("region", { name: "Needs you" });
  await expect(block).toContainText("Journey book wants to run gh pr checks --watch");
  await expect(block).toContainText("Ideas, ranked by value is Stuck: stopped twice with no PR");
  await expect(block).toContainText("Notify me is ready for review, checks passed");
  await expect(block.getByRole("link", { name: /^Review · Notify me/ })).toBeVisible();
  const tile = page
    .getByRole("main")
    .getByRole("list", { name: "Workspaces" })
    .getByRole("link", { name: /Toolshed/ });
  await expect(tile).toContainText("2 need you · 1 for review");
  await shot(page, "tablet-home-builders-in-needs-you");

  await block
    .getByRole("button", { name: "Allow: Journey book wants to run gh pr checks --watch" })
    .click();
  await expect.poll(() => allowed).toBe(1);
  await block.getByRole("button", { name: "Retry Ideas, ranked by value" }).click();
  await expect.poll(() => retried).toBe(1);
});
