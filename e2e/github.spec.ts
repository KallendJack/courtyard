import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { pageScroll, pageScrollsSideways } from "./page-scroll.ts";

// Signing in to GitHub through Courtyard (#99), against the fake GitHub start-worker.mjs gives the
// worker: its sign-in finishes a couple of seconds after it starts, as entering the code on
// another device would.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("the owner signs in to GitHub from Connections with a device code, and a code workspace says when it isn't", async ({
  page,
  context,
}) => {
  // GitHub itself is never reached: the page it opens is a stand-in.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }),
  );
  const notConnected = page.getByRole("region", { name: "GitHub isn't connected" });
  await page.goto("/workspaces/side-project");
  await expect(notConnected).toContainText("can't push its branch or open a pull request");

  await notConnected.getByRole("link", { name: "Sign in to GitHub" }).click();
  await expect(page).toHaveURL(/\/settings#connections$/);
  const connections = page.getByRole("region", { name: "Connections" });
  const github = connections.getByRole("listitem", { name: /^GitHub/ });
  await expect(github).toContainText("Not connected");
  await github.getByRole("button", { name: "Sign in to GitHub" }).click();

  await expect(github).toContainText("Waiting for you");
  await expect(github).toContainText("Open github.com/login/device and enter this code");
  await expect(github).toContainText("FAKE-0001");
  const opened = page.waitForEvent("popup");
  await github.getByRole("link", { name: "Copy, open GitHub" }).click();
  expect((await opened).url()).toBe("https://github.com/login/device");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("FAKE-0001");

  // The page carries on by itself once the owner has said yes on GitHub. It says how many repos
  // the GitHub App reaches, never their names (#286): picking one is New workspace's.
  const signedIn = connections.getByRole("listitem", { name: "GitHub · octo-owner" });
  await expect(signedIn).toContainText("Reaches 62 repositories", { timeout: 15_000 });
  await expect(signedIn).not.toContainText("garrett-kitchens");
  await expect(signedIn).not.toContainText("archive-");
  await expect(signedIn).toContainText("Connected");

  await page.goto("/workspaces/side-project");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(notConnected).toBeHidden();

  await page.goto("/settings");
  await signedIn.getByRole("button", { name: "Sign out" }).click();
  await expect(github).toContainText("Not connected");
});

// From session to pull request (#172): on this worker the fake GitHub opens a pull request for a
// session branch once it's pushed, and its e2e check fails on every commit.
test("a code session shows its branch and pull request, and a failing check starts a turn to fix it", async ({
  page,
  request,
}) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(
      async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind,
      {
        timeout: 15_000,
      },
    )
    .toBe("signed-in");

  await page.goto("/workspaces/side-project");
  await page.getByLabel("Model").selectOption("fake/echo");
  await page
    .getByLabel("Message", { exact: true })
    .fill(
      [
        "edit file talk.md: Talk into the message box",
        "run command: git add talk.md",
        'run command: git commit -m "Talk into the message box"',
        "run command: git push -u origin HEAD",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);

  const strip = page.getByRole("region", { name: "Branch and pull request" });
  await expect(strip).toContainText(/courtyard\/\w+/);
  await expect(strip.getByRole("link", { name: /^PR #\d+/ })).toBeVisible();
  await expect(strip).toContainText("e2e failed · fixing it");
  // The turn the failed check started opens with it, in its activity.
  const failedCheck = page
    .getByRole("list", { name: "What the model did" })
    .getByRole("listitem")
    .filter({ hasText: "Check e2e failed" });
  await expect(failedCheck).toBeVisible();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: The checks on your pull request",
  );
  // Once the fixing turn has ended, the check is still failed: nothing new was pushed.
  await expect(strip).toContainText("e2e failed");
  await expect(strip).not.toContainText("fixing it");

  await page.reload();
  await expect(strip).toContainText("e2e failed");
  await expect(failedCheck).toBeVisible();

  await request.post("/api/github/sign-out", { data: {} });
});

/** Signs in to the fake GitHub, which finishes by itself a couple of seconds later. */
const signIn = async (request: APIRequestContext) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(
      async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind,
      { timeout: 15_000 },
    )
    .toBe("signed-in");
};

/** What the fake model does to make a pull request: write talk.md, commit with `subject`, push. */
const makesPullRequest = (line: string, subject: string) =>
  [
    `edit file talk.md: ${line}`,
    "run command: git add talk.md",
    `run command: git commit -m "${subject}"`,
    "run command: git push -u origin HEAD",
  ].join("\n");

/** Starts a code session on the fake that opens a pull request, and waits for it to show. */
const sessionWithPullRequest = async (page: Page, subject: string) => {
  await page.goto("/workspaces/side-project");
  await page.getByLabel("Model").selectOption("fake/echo");
  await page
    .getByLabel("Message", { exact: true })
    .fill(makesPullRequest("Talk into the message box", subject));
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);
  const strip = page.getByRole("region", { name: "Branch and pull request" });
  await expect(strip.getByRole("link", { name: /^PR #\d+/ })).toBeVisible();
  return strip;
};

// Reviewing a session's pull request in Courtyard (#160): on this worker the fake GitHub's e2e
// check runs, passes or fails as each commit's subject says.
test("the owner reviews a session's pull request file by file, asks for a change, and merges it once its checks pass", async ({
  page,
  request,
}) => {
  await signIn(request);
  // Main's build, once it's merged: still running, so Update Courtyard waits for it (#249).
  await page.route("**/api/live", (route) =>
    route.fulfill({
      json: {
        kind: "live",
        running: { commit: "a".repeat(40), title: "a1b2c3d The running version" },
        newest: { commit: "b".repeat(40), title: "bbbbbbb Hold to talk" },
        newerOnMain: true,
        lastUpdate: null,
        build: {
          kind: "running",
          stages: [
            [
              {
                name: "Checks",
                outcome: "running",
                startedAt: null,
                completedAt: null,
                shards: null,
                needs: [],
              },
            ],
          ],
          startedAt: null,
          endsAround: null,
        },
      },
    }),
  );
  const strip = await sessionWithPullRequest(page, "Talk into the message box [e2e running]");
  await expect(strip).toContainText("+1 −0 · 1 file");

  await strip.getByRole("link", { name: /^PR #\d+/ }).click();
  const review = page.getByRole("region", { name: "Review" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^#\d+ Talk into the message box \[e2e running\]$/,
  );
  await expect(page.getByText("Checks running", { exact: true })).toBeVisible();
  const files = review.getByRole("navigation", { name: "Changed files" });
  await expect(files.getByRole("button", { name: /talk\.md/ })).toContainText("+1");
  const diff = review.getByRole("region", { name: "Diff of talk.md" });
  await expect(diff).toContainText("Talk into the message box");
  const merge = review.getByRole("button", { name: "Merge", exact: true });
  await expect(merge).toBeDisabled();
  await expect(review).toContainText("Merge waits for e2e to finish.");

  // Asking for changes is a message in the session, from its conversation: its fix goes to the
  // same pull request.
  const conversation = page.url().replace(/\?view=review$/, "");
  await page.goto(conversation);
  await page
    .getByLabel("Message", { exact: true })
    .fill(makesPullRequest("Hold to talk", "Hold to talk as well [e2e passes]"));
  await page.getByRole("button", { name: "Send" }).click();
  await expect(strip).toContainText("checks passed");

  await strip.getByRole("link", { name: /^PR #\d+/ }).click();
  await expect(page.getByText("Checks passed", { exact: true })).toBeVisible();
  await expect(diff).toContainText("Hold to talk");
  await expect(merge).toBeEnabled();
  await merge.click();

  // Merged, the page folds to one card with what's next, and nothing left to act on (#278).
  const merged = page.getByRole("region", { name: "Merged" });
  await expect(merged).toContainText("Merged into main");
  await expect(merged).toContainText("1 file · +1 · its session has ended");
  await expect(merged.getByRole("link", { name: "Start a new session" })).toBeVisible();
  await expect(merged.getByRole("button", { name: "Update Courtyard" })).toBeDisabled();
  await expect(merge).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Ask about this PR" })).toHaveCount(0);
  await expect(diff).toHaveCount(0);
  await merged.getByRole("button", { name: "Show the changes" }).click();
  await expect(diff).toContainText("Hold to talk");

  // The conversation says, in one quiet line, that the session takes no more messages.
  await page.goto(conversation);
  await expect(strip).toContainText("merged");
  await expect(page.getByText("Its pull request was merged")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  await request.post("/api/github/sign-out", { data: {} });
});

test("the owner closes a session's pull request without merging it, once they've confirmed", async ({
  page,
  request,
}) => {
  await signIn(request);
  const strip = await sessionWithPullRequest(page, "Talk into the message box [e2e running]");
  await strip.getByRole("link", { name: /^PR #\d+/ }).click();
  const review = page.getByRole("region", { name: "Review" });

  await review.getByRole("button", { name: "Close PR" }).click();
  const confirm = page.getByRole("region", { name: /^Close PR #\d+\?$/ });
  await expect(confirm).toContainText("without merging");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();

  await review.getByRole("button", { name: "Close PR" }).click();
  await confirm.getByRole("button", { name: "Close PR" }).click();

  await expect(page.getByRole("region", { name: "Closed" })).toContainText(
    "Closed without merging",
  );
  await page.goto(page.url().replace(/\?view=review$/, ""));
  await expect(strip).toContainText("closed");
  await expect(page.getByText("Its pull request was closed")).toBeVisible();

  await request.post("/api/github/sign-out", { data: {} });
});

// The setup check (#181): Side project's repository has none of what Matt Pocock's setup skill
// writes, so its Home offers it, once signed in, as a row of Needs you that opens one approval
// (#301).
test("the setup check offers what the repository is missing of Matt's setup, and Allow opens a pull request", async ({
  page,
  request,
}) => {
  await signIn(request);

  await page.goto("/workspaces/side-project");
  const offer = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem", { name: "Add Matt's setup to this repo?" });
  await offer.getByRole("button", { name: "Review" }).click();
  const card = page.getByRole("region", { name: "Needs your OK" });
  await expect(card).toContainText("Add Matt's setup to this repo?");
  await expect(card.getByRole("code")).toContainText("docs/agents/issue-tracker.md");
  await expect(card.getByRole("code")).toContainText("The Agent skills section in AGENTS.md");
  await expect(card.getByRole("code")).toContainText("Labels on GitHub: needs-triage");
  await card.getByRole("button", { name: "Allow" }).click();

  const done = page.getByRole("region", { name: "Matt's setup" });
  await expect(done.getByRole("link", { name: /^pull request #\d+$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(card).toHaveCount(0);

  await request.post("/api/github/sign-out", { data: {} });
});

/**
 * Starts a code session through the API whose fake model commits with `subject` (its checks as the
 * subject says) and a description of these paragraphs, and pushes, which opens its pull request:
 * the session's id, once the workspace's list has the pull request.
 */
const pullRequestFrom = async (
  request: APIRequestContext,
  subject: string,
  description: readonly string[] = [],
) => {
  const messages = [subject, ...description].map((part) => `-m "${part}"`).join(" ");
  const started = await request.post("/api/workspaces/side-project/sessions", {
    data: {
      text: [
        `edit file talk.md: ${subject}`,
        "run command: git add talk.md",
        `run command: git commit ${messages}`,
        "run command: git push -u origin HEAD",
      ].join("\n"),
      model: { provider: "fake", model: "echo" },
    },
  });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await expect
    .poll(
      async () => {
        const listed = await request.get("/api/workspaces/side-project/sessions");
        const { sessions } = (await listed.json()) as {
          sessions: { id: string; pullRequest?: unknown }[];
        };
        return sessions.find((session) => session.id === id)?.pullRequest !== undefined;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return id;
};

/** A description as the house's PR skill writes one: Summary, Evidence and Merge Danger. */
const SLOTS_DESCRIPTION = [
  "## Summary",
  "Three session slots replace the recent list. The cross moves a session to History without deleting it.",
  "## Evidence",
  "A new e2e test failed before and passes now.",
  "## Merge Danger",
  "Two-way door, the workspace page only.",
  "Closes #222",
];

/**
 * Opens the PR page of start-worker.mjs's wide review, which no session opened (#278), from the
 * PRs list: over 300 lines, one of them long, and a long description.
 */
const opensWideReview = async (page: Page) => {
  await page.goto("/workspaces/side-project#prs");
  const row = page
    .getByRole("region", { name: /^Pull requests/ })
    .getByRole("listitem", { name: /A wide review/ });
  await expect(row).toContainText("wide-review");
  await expect(row).toContainText("from octo-owner on GitHub");
  await row.getByRole("link", { name: /^Review/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^#\d+ A wide review \[e2e passes\]$/,
  );
};

/**
 * The PR page fits one screen (#278): the page never scrolls as a whole, Merge and the ask line
 * stay in view, the diff scrolls inside its panel, a long line doesn't wrap, the file tree stays
 * in view while the diff scrolls, and the whole description reads inside a panel of its own.
 */
const fitsOneScreen = async (page: Page) => {
  const review = page.getByRole("region", { name: "Review" });
  const merge = review.getByRole("button", { name: "Merge", exact: true });
  const ask = review.getByRole("textbox", { name: "Ask about this PR" });
  const files = review.getByRole("navigation", { name: "Changed files" });
  const lines = review.locator("[data-diff-lines]");
  await expect(merge).toBeEnabled();
  await expect(merge).toBeInViewport({ ratio: 1 });
  await expect(ask).toBeInViewport({ ratio: 1 });
  expect((await pageScroll(page)).scrolls).toBe(false);

  const scrolls = () =>
    lines.evaluate((box) => ({
      down: box.scrollHeight > box.clientHeight,
      sideways: box.scrollWidth > box.clientWidth,
    }));
  expect(await scrolls()).toEqual({ down: true, sideways: true });
  const long = lines.getByText(/a long line that never wraps/);
  expect((await long.boundingBox())?.height).toBeLessThan(30);

  await lines.evaluate((box) => box.scrollTo({ top: box.scrollHeight }));
  await expect(review.getByText("export const line320 = 320;")).toBeInViewport();
  await expect(files).toBeInViewport({ ratio: 1 });
  await expect(merge).toBeInViewport({ ratio: 1 });
  expect((await pageScroll(page)).scrolls).toBe(false);

  const whatChanged = review.getByRole("region", { name: "What changed" });
  await whatChanged.getByRole("button", { name: "Read it all" }).click();
  await expect(whatChanged).toContainText("Paragraph 40 of a long description");
  await expect(merge).toBeInViewport({ ratio: 1 });
  await expect(ask).toBeInViewport({ ratio: 1 });
  expect((await pageScroll(page)).scrolls).toBe(false);
  await whatChanged.getByRole("button", { name: "Show less" }).click();
};

// The PR page on a desktop (#278; Paper, "Desktop · PR page" and "Desktop · PRs: every open PR"):
// the whole width, Close PR and the main action beside the title.
test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the PR page fits the screen with a long diff and description, and the diff scrolls inside it", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await opensWideReview(page);
    const review = page.getByRole("region", { name: "Review" });
    const title = page.getByRole("heading", { level: 1 });
    const merge = review.getByRole("button", { name: "Merge", exact: true });
    // Beside the title, not under the diff.
    const [titleBox, mergeBox] = [await title.boundingBox(), await merge.boundingBox()];
    expect(mergeBox?.y ?? 0).toBeLessThan((titleBox?.y ?? 0) + (titleBox?.height ?? 0) + 40);
    await fitsOneScreen(page);
    await request.post("/api/github/sign-out", { data: {} });
  });

  test("the PRs list shows every open pull request, and the ask line on one no session opened starts a session on its branch", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await page.goto("/workspaces/side-project#prs");
    const row = page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Builds queue across the whole PC/ });
    await expect(row).toContainText("306-machine-lock");
    await expect(row).toContainText("from a Claude Code helper");
    await expect(row).toContainText("Checks running");
    await row.getByRole("link", { name: /^Review/ }).click();
    await expect(page).toHaveURL(/\/workspaces\/side-project#pr-\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^#\d+ Builds queue across the whole PC/,
    );
    const review = page.getByRole("region", { name: "Review" });
    await expect(review.getByRole("region", { name: "What changed" })).toContainText(
      "Builds take turns across the whole PC",
    );

    // What starts is shown before it starts: on its branch, with the model it'll use.
    await review.getByRole("button", { name: "Can this be merged?" }).click();
    const start = review.getByRole("region", { name: "Start a session" });
    await expect(start).toContainText("306-machine-lock");
    await expect(start).toContainText("asking “Can this be merged?”");
    await start.getByRole("button", { name: "Start the session" }).click();

    await expect(page).toHaveURL(/\/sessions\/[\w-]+\?view=review$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^#\d+ Builds queue across the whole PC/,
    );
    await expect(review.getByRole("region", { name: "Answer" })).toContainText(
      "You said: Can this be merged?",
    );
    await page.goto("/workspaces/side-project#prs");
    await expect(row).toContainText("from the session");

    await request.post("/api/github/sign-out", { data: {} });
  });
});

// The PRs tab and the review on the unfolded Fold (#240; Paper, "Tablet · PRs tab", "Tablet · PR
// review and Merge" and "description open"). Until the workspace page has tabs (#222), the PRs
// tab's list is a section of a code workspace's page.
test.describe("on the unfolded Fold", () => {
  test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

  test("the PRs list shows each pull request's checks, and its review reads the description and merges", async ({
    page,
    request,
  }) => {
    await signIn(request);
    const id = await pullRequestFrom(
      request,
      "Three session slots [e2e passes]",
      SLOTS_DESCRIPTION,
    );
    await pullRequestFrom(request, "Fix the model chip [e2e running]");
    await pullRequestFrom(request, "Workspace icon picker");

    await page.goto("/workspaces/side-project#prs");
    const pullRequests = page.getByRole("region", { name: /^Pull requests · \d+ open$/ });
    const row = (title: string) => pullRequests.getByRole("listitem", { name: new RegExp(title) });
    await expect(row("Three session slots")).toContainText("Checks passed");
    await expect(row("Fix the model chip")).toContainText("Checks running");
    await expect(row("Workspace icon picker")).toContainText("1 check failed");
    await expect(row("Three session slots")).toContainText(/courtyard\/\w+/);

    await row("Three session slots")
      .getByRole("link", { name: /^Review/ })
      .click();
    await expect(page).toHaveURL(/view=review/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^#\d+ Three session slots \[e2e passes\]$/,
    );
    const review = page.getByRole("region", { name: "Review" });
    const whatChanged = review.getByRole("region", { name: "What changed" });
    const files = review.getByRole("navigation", { name: "Changed files" });
    await expect(whatChanged).toContainText("Three session slots replace the recent list.");
    await expect(whatChanged).not.toContainText("A new e2e test");
    await expect(files).toBeVisible();

    await whatChanged.getByRole("button", { name: "Read it all" }).click();
    await expect(whatChanged).toContainText("without deleting it");
    await expect(whatChanged).toContainText("A new e2e test failed before and passes now.");
    await expect(whatChanged).toContainText("Two-way door, the workspace page only.");
    // What's for GitHub stays on GitHub.
    await expect(whatChanged).not.toContainText("Closes #222");
    await expect(files).toBeHidden();
    await expect(review).toContainText("1 file changed · +1");
    await review.getByRole("button", { name: "View the diff" }).click();
    await expect(files).toBeVisible();
    await expect(whatChanged).not.toContainText("A new e2e test");

    await whatChanged.getByRole("button", { name: "Read it all" }).click();
    await whatChanged.getByRole("button", { name: "Show less" }).click();
    await expect(files).toBeVisible();

    await review.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByRole("region", { name: "Merged" })).toContainText("Merged into main");

    // The merged session leaves the workspace's sessions for History (#278), on its Sessions tab.
    await page.goto("/workspaces/side-project#sessions");
    const link = `a[href$="/sessions/${id}"]`;
    await expect(page.getByRole("region", { name: "History" }).locator(link)).toBeVisible();
    await expect(page.getByRole("region", { name: "Sessions" }).locator(link)).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Workspace tabs" })
      .getByRole("link", { name: /^PRs/ })
      .click();
    await expect(row("Three session slots")).toHaveCount(0);
    await pullRequests.locator("label", { hasText: /^Merged$/ }).click();
    const merged = page.getByRole("region", { name: /^Pull requests · \d+ merged$/ });
    await expect(merged.getByRole("listitem", { name: /Three session slots/ })).toContainText(
      "Merged",
    );

    await request.post("/api/github/sign-out", { data: {} });
  });

  // #319: a long branch ran under its checks and the Review button.
  test("a pull request's long branch is cut short, clear of its checks", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await page.goto("/workspaces/side-project#prs");
    const row = page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Bump home-assistant/ });
    const branch = row.getByText(/^dependabot\/docker_compose\//);
    const checks = row.getByText("Checks passed", { exact: true }).locator("visible=true");
    await expect(checks).toBeVisible();
    const [branchBox, checksBox] = [await branch.boundingBox(), await checks.boundingBox()];
    expect((branchBox?.x ?? 0) + (branchBox?.width ?? 0)).toBeLessThanOrEqual(checksBox?.x ?? 0);
    await request.post("/api/github/sign-out", { data: {} });
  });

  test("the PR page fits the screen with a long diff and description, and the diff scrolls inside it", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await opensWideReview(page);
    await fitsOneScreen(page);
    await request.post("/api/github/sign-out", { data: {} });
  });

  test("a conflicting pull request says so, and one tap has its session bring it up to date", async ({
    page,
    request,
  }) => {
    await signIn(request);
    const id = await pullRequestFrom(request, "Rails room [e2e running] [conflicts]");

    await page.goto("/workspaces/side-project#prs");
    const row = page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Rails room/ });
    // Not "No checks": a conflict is what holds it up.
    await expect(row).toContainText("Conflicts with main");
    await expect(row.getByRole("button", { name: /^Bring up to date/ })).toBeVisible();

    await page.goto(`/workspaces/side-project/sessions/${id}?view=review`);
    const review = page.getByRole("region", { name: "Review" });
    await expect(review).toContainText("Conflicts with main");
    await expect(review.getByRole("button", { name: "Merge", exact: true })).toHaveCount(0);
    await expect(review.getByRole("button", { name: "Why does it conflict?" })).toBeVisible();
    await review.getByRole("button", { name: "Bring up to date" }).click();

    // It shows the session, which has the message to merge main in.
    await expect(page).toHaveURL(new RegExp(`/sessions/${id}$`));
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      /Your pull request #\d+ conflicts with main/,
    );

    await request.post("/api/github/sign-out", { data: {} });
  });

  // #279: the review's message box went to the workspace's first session, not the PR's own.
  test("a pull request's review sends its message to the session that opened it", async ({
    page,
    request,
  }) => {
    await signIn(request);
    const first = await pullRequestFrom(request, "Rail spacing [e2e running]");
    const second = await pullRequestFrom(request, "Loading states [e2e running]");
    // The fake titles a session with its first message's first words.
    const firstTitle = "Edit File Talk Md Rail";
    const secondTitle = "Edit File Talk Md Loading";

    await page.goto("/workspaces/side-project#prs");
    await page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Loading states/ })
      .getByRole("link", { name: /^Review/ })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Loading states/);

    // The ask line goes to the session whose branch the pull request is, with no pickers, and its
    // answer shows on the page, in place of What changed (#278).
    const review = page.getByRole("region", { name: "Review" });
    const ask = page.getByRole("textbox", { name: "Ask about this PR" });
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await ask.fill("Bring it up to date with main");
    await review.getByRole("button", { name: "Ask", exact: true }).click();
    const answer = review.getByRole("region", { name: "Answer" });
    await expect(answer).toContainText("You said: Bring it up to date with main");
    await expect(review.getByRole("region", { name: "What changed" })).toHaveCount(0);
    await expect(ask).toHaveValue("");
    // A quick ask sends with one tap; the answer shown is the latest.
    await review.getByRole("button", { name: "Explain this change" }).click();
    await expect(answer).toContainText("You said: Explain this change");
    await answer.getByRole("button", { name: "Close the answer" }).click();
    await expect(review.getByRole("region", { name: "What changed" })).toBeVisible();

    await page.goto(`/workspaces/side-project/sessions/${second}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(secondTitle);
    await expect(page.getByText("Bring it up to date with main").first()).toBeVisible();
    await page.goto(`/workspaces/side-project/sessions/${first}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(firstTitle);
    await expect(page.getByText("Bring it up to date with main")).toHaveCount(0);

    // A review whose session has gone has no ask line, so nothing goes to another session.
    const deleted = await request.delete(`/api/sessions/${first}`, { data: {} });
    expect(deleted.ok(), await deleted.text()).toBe(true);
    await page.goto(`/workspaces/side-project/sessions/${first}?view=review`);
    await expect(ask).toHaveCount(0);

    await request.post("/api/github/sign-out", { data: {} });
  });

  // A code workspace from the app (#258, #264; Paper, "Tablet · New workspace, Code"): Code lists
  // the repos Courtyard's GitHub App reaches, and the one picked comes onto the worker machine.
  test("New workspace opens with nothing focused, and Code makes a workspace on a picked repo, its name filled in", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await page.goto("/new-workspace");
    await expect(page.getByRole("heading", { level: 1, name: "New workspace" })).toBeVisible();
    // On a touch screen the keyboard waits for a tap, so nothing is focused.
    await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    const kind = page.getByRole("group", { name: "Kind" });
    await kind.locator("label", { has: page.getByRole("radio", { name: "Code" }) }).click();
    const repos = page.getByRole("group", { name: "Repo" });
    // Side project's repo is a code workspace's already: greyed, and it can't be picked.
    await expect(repos.getByRole("radio", { name: /^side-project/ })).toBeDisabled();
    await expect(repos.locator("label", { hasText: "side-project" })).toContainText("Added");
    await repos.locator("label", { hasText: "garrett-kitchens" }).click();

    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Garrett Kitchens");
    await expect(page.getByRole("textbox", { name: "What's it for?" })).toHaveValue(
      "Website for a kitchen fitter: reconnect with the client and try new designs",
    );
    await page.getByRole("button", { name: "Create Garrett Kitchens" }).click();

    await expect(page).toHaveURL(/\/workspaces\/garrett-kitchens#connections$/);
    await expect(page.getByRole("heading", { level: 1, name: "Garrett Kitchens" })).toBeVisible();
    // Its Connections sheet offers Paper right away, its file of the same name picked (#308), and
    // Close skips it, leaving the workspace with no Paper file.
    const sheet = page.getByRole("dialog", { name: "Connections" });
    await expect(
      sheet
        .getByRole("group", { name: "Paper file" })
        .getByRole("radio", { name: "Garrett Kitchens" }),
    ).toBeChecked();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/workspaces\/garrett-kitchens$/);
    await expect(page.getByRole("button", { name: /No Paper file/ })).toContainText(
      "No Paper file",
    );
    await page.goto("/new-workspace");
    await kind.locator("label", { has: page.getByRole("radio", { name: "Code" }) }).click();
    await expect(repos.getByRole("radio", { name: /^garrett-kitchens/ })).toBeDisabled();

    await request.post("/api/github/sign-out", { data: {} });
  });
});

test.describe("on the cover screen", () => {
  test.use({ viewport: { width: 400, height: 900 }, hasTouch: true, isMobile: true });

  test("the PRs list and the review fit the narrow screen", async ({ page, request }) => {
    await signIn(request);
    await pullRequestFrom(request, "A narrow look [e2e running]", SLOTS_DESCRIPTION);

    await page.goto("/workspaces/side-project#prs");
    const row = page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /A narrow look/ });
    await expect(row).toContainText("Checks running");
    await row.getByRole("link", { name: /^Review/ }).click();

    const review = page.getByRole("region", { name: "Review" });
    await review.getByRole("button", { name: "Read it all" }).click();
    await expect(review).toContainText("Two-way door, the workspace page only.");
    await expect(review.getByRole("button", { name: "Merge", exact: true })).toBeDisabled();
    expect(await pageScrollsSideways(page)).toBe(false);

    await request.post("/api/github/sign-out", { data: {} });
  });
});

// A code workspace's Home (#301; Paper, "Code workspace Home", desktop, tablet and cover screen)
// and connecting Paper from it (#308), on start-worker.mjs's Workbench: its one line, ready
// issues on the fake GitHub in milestones (one claimed), and a helper's pull request whose checks
// passed. Tests here run in order: the last ones build an issue and merge the pull request.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const HOME = "/workspaces/workbench";

/** Home's blocks, by their labels. */
const blocks = (page: Page) => ({
  needsYou: page.getByRole("region", { name: "Needs you" }),
  running: page.getByRole("region", { name: "Running" }),
  nextUp: page.getByRole("region", { name: "Next up" }),
});

/** What every Home shows of Workbench before anything is built or merged. */
const showsHome = async (page: Page) => {
  await page.goto(HOME);
  await expect(page.getByRole("heading", { level: 1, name: "Workbench" })).toBeVisible();
  await expect(
    page.getByText("Plan and code with AI models, one workspace per area of life"),
  ).toBeVisible();
  const line = page.getByRole("button", { name: /octo-owner\/workbench/ });
  await expect(line).toContainText("No Paper file");

  const { needsYou, running, nextUp } = blocks(page);
  await expect(needsYou).toContainText(/Needs you · \d+/);
  const ready = needsYou.getByRole("listitem", { name: /Builds take turns/ });
  await expect(ready).toContainText("Checks passed · ready to merge");
  await expect(ready.getByRole("button", { name: /^Merge/ })).toBeVisible();
  // Nothing runs yet, so its block isn't there at all.
  await expect(running).toHaveCount(0);

  // The ready issues nobody claimed, in milestone order: three, then More.
  await expect(nextUp).toContainText("4 · Code workspaces");
  await expect(nextUp.getByRole("region", { name: "Build #197" })).toContainText(
    "The rail on desktop",
  );
  await expect(nextUp.getByRole("listitem")).toHaveText([
    /#251\s*One Reply box everywhere/,
    /#255\s*Paste images on the Fold/,
  ]);
  await expect(nextUp).not.toContainText("Claimed by a helper");
  await expect(nextUp.getByRole("button", { name: "More · 9" })).toBeVisible();

  // Main's newest commit with its build, and no Update: it isn't the live copy's repository.
  const main = page.getByRole("region", { name: "Main" });
  await expect(main).toContainText(/Start [0-9a-f]{7}/);
  await expect(main.getByRole("status")).toHaveText("Passed · 3:00");
  await expect(main.getByRole("button", { name: "Update" })).toHaveCount(0);
  // A tap opens its full graph: its jobs in the workflow's order, whatever order GitHub gave.
  await main.getByRole("button", { name: /Main's build/ }).click();
  const graph = page.getByRole("dialog", { name: "Main's build" });
  await expect(graph.getByRole("list", { name: "Main's build" }).getByRole("listitem")).toHaveText([
    /^Checks: passed/,
    /^Unit tests: passed/,
    /^E2E: passed/,
  ]);
  await graph.getByRole("button", { name: "Done" }).click();
  await expect(graph).toBeHidden();

  // Tabs show once they have something: no sessions yet, one pull request.
  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "PRs1"]);
  // A code workspace has no context file, Things or skills on its page (#301).
  await expect(page.getByRole("region", { name: "Context file" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Skills" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
};

/** The page doesn't scroll at all: everything on Home is on one screen. */
const homeFitsOneScreen = async (page: Page) => {
  await expect.poll(async () => (await pageScroll(page)).scrolls).toBe(false);
};

/** Tapping Build on Next up's first issue keeps Start building and Cancel inside its card. */
const buildButtonsFitTheirCard = async (page: Page) => {
  const build = blocks(page).nextUp.getByRole("region", { name: "Build #197" });
  await build.getByRole("button", { name: "Build" }).click();
  const [card, start, cancel] = await Promise.all([
    build.boundingBox(),
    build.getByRole("button", { name: "Start building" }).boundingBox(),
    build.getByRole("button", { name: "Cancel" }).boundingBox(),
  ]);
  if (card === null || start === null || cancel === null) throw new Error("Not on the page");
  for (const button of [start, cancel]) {
    expect(button.x).toBeGreaterThanOrEqual(card.x);
    expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width);
  }
  await build.getByRole("button", { name: "Cancel" }).click();
  await expect(build.getByRole("button", { name: "Build" })).toBeVisible();
};

test.describe("a code workspace's Home (#301, #308)", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("on a desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("Home shows what waits on the owner and what's next, each block in its place, on one screen", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await showsHome(page);
      await homeFitsOneScreen(page);
      // Next up sits beside Needs you, not under it.
      const [needsBox, nextBox] = [
        await blocks(page).needsYou.boundingBox(),
        await blocks(page).nextUp.boundingBox(),
      ];
      expect(nextBox?.x ?? 0).toBeGreaterThan((needsBox?.x ?? 0) + (needsBox?.width ?? 0));
      await shot(page, "desktop-home");
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner rule (2026-10-12): nothing jumps in late. What loads after the page shows the last
    // answer known at once on a revisit, asked for again quietly.
    test("coming back to a code workspace shows its pull requests at once, while they're asked for again", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(`${HOME}#prs`);
      const row = page
        .getByRole("region", { name: /^Pull requests/ })
        .getByRole("listitem", { name: /Builds take turns/ });
      await expect(row).toBeVisible();

      // GitHub answers slowly from now on: the way back mustn't wait for it.
      await page.route("**/api/workspaces/workbench/pull-requests", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await route.continue();
      });
      const workspaces = page.getByRole("navigation", { name: "Workspaces" });
      await workspaces.getByRole("link", { name: "Side project" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Side project" })).toBeVisible();
      await workspaces.getByRole("link", { name: "Workbench" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Workbench" })).toBeVisible();
      await page
        .getByRole("navigation", { name: "Workspace tabs" })
        .getByRole("link", { name: /^PRs/ })
        .click();
      await expect(row).toBeVisible({ timeout: 2000 });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });
  });

  test.describe("on the unfolded Fold", () => {
    test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

    test("Home fits one screen, and More shows the rest of Next up", async ({ page, request }) => {
      await signIn(request);
      await showsHome(page);
      await homeFitsOneScreen(page);
      await shot(page, "tablet-home");

      const { nextUp } = blocks(page);
      await nextUp.getByRole("button", { name: "More · 9" }).click();
      await expect(nextUp.getByRole("listitem")).toHaveCount(11);
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("once Build is tapped, Start building and Cancel stay inside its card (#346)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      await buildButtonsFitTheirCard(page);
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("the connections line opens Connections, with the file named after the workspace picked, and one tap connects it", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      await page.getByRole("button", { name: /octo-owner\/workbench/ }).click();

      const sheet = page.getByRole("dialog", { name: "Connections" });
      await expect(sheet.getByRole("region", { name: "GitHub" })).toContainText(
        "Connected · octo-owner/workbench",
      );
      const files = sheet.getByRole("group", { name: "Paper file" });
      await expect(files.getByRole("radio", { name: "Workbench" })).toBeChecked();
      await expect(files.locator("label", { hasText: "Workbench" })).toContainText("Same name");
      await expect(files.getByRole("radio", { name: "Courtyard" })).not.toBeChecked();
      await expect(files.getByRole("radio", { name: "Make a new file" })).toBeVisible();
      await shot(page, "tablet-connect-paper");

      await sheet.getByRole("button", { name: "Connect Workbench" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: /octo-owner\/workbench/ })).toContainText(
        "Paper · Workbench",
      );
      // It's kept: the page says so after a reload.
      await page.reload();
      await expect(page.getByRole("button", { name: /octo-owner\/workbench/ })).toContainText(
        "Paper · Workbench",
      );
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("an approval waiting is a row of Needs you, approved in one tap, and a working session shows in Running", async ({
      page,
      request,
    }) => {
      await signIn(request);
      const asks = await request.post("/api/workspaces/workbench/sessions", {
        data: {
          text: "run command: git merge origin/main (for: Bring #251 up to date)",
          model: { provider: "fake", model: "echo" },
        },
      });
      expect(asks.status()).toBe(201);
      // A long answer keeps its turn working for a while (the fake writes a word every 40 ms).
      const works = await request.post("/api/workspaces/workbench/sessions", {
        data: {
          text: `Activity lines ${"word ".repeat(900)}`,
          model: { provider: "fake", model: "echo" },
        },
      });
      const working = ((await works.json()) as { id: string }).id;

      await page.goto(HOME);
      const { needsYou, running } = blocks(page);
      const approval = needsYou.getByRole("listitem", { name: "Run git merge origin/main?" });
      await expect(approval).toContainText("asked", { timeout: 45_000 });
      await expect(running.getByRole("listitem")).toContainText(/Activity lines/, {
        timeout: 45_000,
      });
      await shot(page, "tablet-home-needs-you-running");

      await approval.getByRole("button", { name: /^Approve/ }).click();
      await expect(approval).toHaveCount(0);

      await request.post(`/api/sessions/${working}/stop`, { data: { turn: 1 } });
      await request.post("/api/github/sign-out", { data: {} });
    });
  });

  test.describe("on the cover screen", () => {
    test.use({ viewport: { width: 400, height: 900 }, hasTouch: true, isMobile: true });

    test("Home is one column in the same order, and nothing scrolls sideways", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { needsYou, nextUp } = blocks(page);
      await expect(nextUp).toBeVisible();
      const [needsBox, nextBox] = [await needsYou.boundingBox(), await nextUp.boundingBox()];
      expect(nextBox?.y ?? 0).toBeGreaterThan((needsBox?.y ?? 0) + (needsBox?.height ?? 0));
      expect(Math.round(nextBox?.width ?? 0)).toBe(Math.round(needsBox?.width ?? 0));
      expect(await pageScrollsSideways(page)).toBe(false);
      await shot(page, "cover-home");
      await request.post("/api/github/sign-out", { data: {} });
    });
  });

  test.describe("building and merging", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    // Before Build below claims #197.
    test("once Build is tapped, Start building and Cancel stay inside its card (#346)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      await buildButtonsFitTheirCard(page);
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("Build shows the issue and its model first, then starts a session on it", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const build = blocks(page).nextUp.getByRole("region", { name: "Build #197" });
      await build.getByRole("button", { name: "Build" }).click();
      await expect(build).toContainText("A new session builds it with Fake (echoes you)");
      await expect(build).toContainText("claims it on GitHub");
      await build.getByRole("button", { name: "Start building" }).click();

      await expect(page).toHaveURL(/\/workspaces\/workbench\/sessions\/[\w-]+$/);
      await expect(page.getByRole("list", { name: "Session" })).toContainText(
        'Build issue #197, "The rail on desktop"',
      );
      // It's claimed, so Next up moves on to the next one.
      await page.goto(HOME);
      await expect(blocks(page).nextUp.getByRole("region", { name: "Build #251" })).toBeVisible();
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("Merge on a pull request ready to merge merges it in one tap", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const ready = blocks(page).needsYou.getByRole("listitem", { name: /Builds take turns/ });
      await ready.getByRole("button", { name: /^Merge/ }).click();
      await expect(ready).toHaveCount(0);
      await request.post("/api/github/sign-out", { data: {} });
    });
  });
});
