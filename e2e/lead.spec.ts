import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { LeadStatus } from "../packages/contract/index.ts";

// A code workspace's Lead (#347; Paper, "2 · Agreed", Code workspace row: Lead not started, the
// Builders board (#592), the Lead's chat), on start-worker.mjs's Toolshed: three ready issues on
// the fake GitHub, in a build order. Tests here run in order, on one Lead.

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const HOME = "/workspaces/toolshed";

test.beforeEach(async ({ request }) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
});

test.afterAll(async ({ request }) => {
  await request.post("/api/github/sign-out", { data: {} });
});

test("Run the build order starts the Lead, which starts two builders and keeps the third next", async ({
  page,
}) => {
  await page.goto(HOME);
  const nextUp = page.getByRole("region", { name: "Next up" });
  const first = nextUp.getByRole("region", { name: "Build #31" });
  await expect(first).toContainText("Hooks on the pegboard");
  await shot(page, "lead-not-started");

  await first.getByRole("button", { name: "Run the build order" }).click();
  const dialog = page.getByRole("dialog", { name: "Run the build order" });
  await expect(dialog).toContainText("The Lead runs the build order");
  await expect(dialog).toContainText("beginning with #31 Hooks on the pegboard");
  // Every builder allows all until its PR opens, and it keeps going through the night (#591).
  await expect(dialog).toContainText("allows all until its PR opens");
  await expect(dialog).toContainText("pauses itself while 4 PRs wait for your review");
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await shot(page, "lead-confirm");
  await dialog.getByRole("button", { name: "Run the build order" }).click();
  await expect(dialog).toBeHidden();

  // The Builders board (#592): two building of two, each a row; the e2e builders ask a question,
  // so each waits on the owner, answered in its session.
  const board = page.getByRole("region", { name: "Builders" });
  await expect(board).toContainText("2 of 2 building · 0 of 4 for review");
  await expect(board.getByRole("listitem")).toHaveCount(2);
  await expect(board.getByRole("link", { name: /^Answer / })).toHaveCount(2);
  await expect(board.getByRole("button", { name: "Pause" })).toBeVisible();
  await shot(page, "lead-running");
});

/** The Lead's chat (#347), which stays as its history (#592), opened by its session. */
const openLeadChat = async (page: Page, request: APIRequestContext) => {
  const real = LeadStatus.parse(await (await request.get(`/api${HOME}/lead`)).json());
  await page.goto(`${HOME}/sessions/${real.session ?? ""}`);
};

test("the Lead's chat shows what it builds, what's next and what's ready to merge", async ({
  page,
  request,
}) => {
  await openLeadChat(page, request);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lead");
  await expect(page.getByText("Started building Hooks on the pegboard")).toBeVisible();
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  const strip = page.getByRole("region", { name: "Build order" });
  await expect(strip).toContainText("Building · 2");
  await expect(strip).toContainText("Hooks on the pegboard");
  await expect(strip).toContainText("Labels on the drawers");
  await expect(strip).toContainText("A light over the bench");
  await expect(strip).toContainText("To merge");
  await shot(page, "lead-chat");
});

test("told to pause, the Lead's builders carry on and nothing new starts; Run wakes it", async ({
  page,
  request,
}) => {
  await openLeadChat(page, request);
  // The chat drawn first, so the box typed in is the one that stays.
  await expect(page.getByRole("region", { name: "Build order" })).toContainText("Building · 2");
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("pause");
  await expect(box).toHaveValue("pause");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Paused", { exact: false }).first()).toBeVisible();

  await page.goto(HOME);
  const board = page.getByRole("region", { name: "Builders" });
  await expect(board).toContainText("Paused · builders carry on, nothing new starts");
  await shot(page, "lead-paused");

  await board.getByRole("button", { name: "Run" }).click();
  await expect(board.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(board).not.toContainText("Paused");
});

// Merge in order and holding back (#423; Paper, "Code Home, Merge in order", "Lead chat, merging
// in order", "merge stopped at a check"). The e2e builders open no pull requests, so the Lead's
// status and the open pull requests are given here as the worker would give them.
test("ready pull requests merge in order from one row, and the Lead's chat says where it is", async ({
  page,
  request,
}) => {
  const real = LeadStatus.parse(await (await request.get(`/api${HOME}/lead`)).json());
  const [first, second] = real.building;
  if (first === undefined || second === undefined) throw new Error("two builders expected");
  const builders = [first, second, first];
  const numbers = [344, 340, 338];
  const ready = numbers.map((number, at) => ({ ...builders[at], pullRequest: number }));
  const pulls = numbers.map((number, at) => ({
    pullRequest: {
      number,
      title: `Pull request ${number}`,
      url: `https://github.com/octo-owner/toolshed/pull/${number}`,
      state: "open",
      head: `c0ffee${at}`,
      checks: { kind: "passed" },
      changes: { additions: 3, deletions: 1, files: 1 },
      conflicts: false,
    },
    branch: `courtyard/e2e${at}`,
    from: { kind: "session", sessionId: builders[at]?.session, title: builders[at]?.title },
    waiting: "merge",
  }));
  let merge: unknown;
  const status = async () => ({
    ...(await (await request.get(`/api${HOME}/lead`)).json()),
    ready,
    heldBack:
      real.next[0] === undefined ? [] : [{ issue: real.next[0].number, behind: first.issue }],
    ...(merge === undefined ? {} : { merge }),
  });
  await page.route(`**/api${HOME}/lead`, async (route) => route.fulfill({ json: await status() }));
  await page.route(`**/api${HOME}/lead/merge-in-order`, async (route) => {
    merge = { kind: "merging", pullRequest: 344 };
    await route.fulfill({ json: await status() });
  });
  await page.route(`**/api${HOME}/pull-requests`, (route) =>
    route.fulfill({ json: { pullRequests: pulls } }),
  );

  await page.goto(HOME);
  // Merge in order is the Builders board's (#592): the builders' pull requests aren't in Needs you.
  const board = page.getByRole("region", { name: "Builders" });
  await expect(board).toContainText("3 of 4 for review");
  const needsYou = page.getByRole("region", { name: /^Needs you/ });
  await expect(needsYou).not.toContainText("#344");
  await expect(needsYou.getByRole("button", { name: /^Merge/ })).toHaveCount(0);
  if (real.next[0] !== undefined) {
    // Held back goes: it waits for the builder's merge, by name.
    const name = first.title.replace(/^Build #\d+: /, "");
    await expect(page.getByRole("region", { name: "Next up" })).toContainText(
      `Next · waits for ${name} to merge`,
    );
    await expect(board).toContainText(`waits for ${name} to merge`);
  }
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  for (const [name, size] of [
    ["tablet", { width: 950, height: 712 }],
    ["cover", { width: 400, height: 900 }],
    ["desktop", { width: 1440, height: 900 }],
  ] as const) {
    await page.setViewportSize(size);
    await board.scrollIntoViewIfNeeded();
    await shot(page, `${name}-code-home-merge-in-order`);
  }
  await page.setViewportSize({ width: 950, height: 712 });

  // The Lead's chat: To merge with Merge in order.
  await page.goto(`${HOME}/sessions/${real.session ?? ""}`);
  const strip = page.getByRole("region", { name: "Build order" });
  await expect(strip).toContainText("To merge3Merge in order");
  await shot(page, "tablet-lead-chat-merging-in-order");

  await page.goto(HOME);
  await board.getByRole("button", { name: "Merge in order" }).click();
  await expect(board).toContainText("Merging #344 in order");
  await expect(board.getByRole("button", { name: "Merge in order" })).toHaveCount(0);

  // Stopped at a check: the chat's To merge says where, in gold.
  merge = { kind: "stopped", pullRequest: 340, why: "its e2e check failed" };
  await page.goto(`${HOME}/sessions/${real.session ?? ""}`);
  await expect(strip).toContainText("Stopped · #340");
  await shot(page, "tablet-lead-chat-merge-stopped-at-a-check");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Paused with merges to tidy (#591): the e2e builders open no pull requests, so the Lead's status
// is given here as the worker would give it.
test("a paused Lead's board says how many merges it tidies up once it runs again", async ({
  page,
  request,
}) => {
  const real = LeadStatus.parse(await (await request.get(`/api${HOME}/lead`)).json());
  await page.route(`**/api${HOME}/lead`, (route) =>
    route.fulfill({ json: { ...real, state: "paused", toTidy: 2 } }),
  );

  await page.goto(HOME);

  const board = page.getByRole("region", { name: "Builders" });
  await expect(board).toContainText("Paused · builders carry on · 2 merges to tidy");
  await expect(board.getByRole("button", { name: "Run" })).toBeVisible();
  await shot(page, "tablet-lead-row-paused-to-tidy");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
