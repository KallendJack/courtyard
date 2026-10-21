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

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

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

// With no builders (#635), the board's one quiet line sits under its header's two lines, inside the
// block, and nothing moves or overlaps: on the Fold, on the Fold with less room (the browser's bars,
// a bigger text size), and on the cover screen.
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
      lead: {
        state: "paused",
        toTidy: 2,
        merge: { kind: "stopped", pullRequest: 612, why: "its e2e check failed" },
      },
      sessions: [],
      issues: [issue(45, "Tidy, one shared piece", false)],
    });
    const empty = board(page).getByText("No builders right now");
    const shifts = await shiftsOn(page, HOME, () => expect(empty).toBeVisible());
    expect(shifts.reduce((sum, shift) => sum + shift.value, 0)).toBeLessThan(0.001);

    const reasons = board(page).getByText(/^Paused · builders carry on/);
    await expect(reasons).toContainText("Merge in order stopped at #612");
    const box = async (of: Locator) => {
      const drawn = await of.boundingBox();
      if (drawn === null) throw new Error("not drawn");
      return { top: drawn.y, bottom: drawn.y + drawn.height };
    };
    const block = await box(board(page));
    const line = await box(empty);
    const header = await box(reasons);
    const needs = await box(page.getByRole("region", { name: "Needs you" }));
    const main = await box(page.getByRole("region", { name: "Main" }));
    await shot(page, name);
    expect(line.top).toBeGreaterThanOrEqual(header.bottom);
    // Inside the block's padding, not on or past its edge.
    expect(line.bottom).toBeLessThanOrEqual(block.bottom - 14);
    // Needs you, under it, still ends above Main.
    expect(needs.top).toBeGreaterThanOrEqual(block.bottom);
    expect(needs.bottom).toBeLessThanOrEqual(main.top);
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
