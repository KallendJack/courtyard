import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { chooseModel } from "./frame.ts";
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
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(notConnected).toBeHidden();

  await page.goto("/settings");
  await signedIn.getByRole("button", { name: "Sign out" }).click();
  await expect(github).toContainText("Not connected");
});

// Owner rule (2026-10-12): nothing jumps in. That GitHub isn't connected comes with the workspace's
// connections line, in its faint place, rather than on its own and above the rest later.
test("a code workspace says GitHub isn't connected with its connections line, not before it", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/workspaces/side-project/connections", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/workspaces/side-project");
  await expect(page.getByRole("heading", { level: 1, name: "Side project" })).toBeVisible();
  await expect(page.locator("main [data-placeholder]").first()).toBeVisible();
  const notConnected = page.getByRole("region", { name: "GitHub isn't connected" });
  // Long enough for a notice of its own to have come.
  await page.waitForTimeout(1000);
  await expect(notConnected).toHaveCount(0);

  release();
  await expect(notConnected).toContainText("can't push its branch or open a pull request");
  await expect(page.getByRole("button", { name: /octo-owner\/side-project|GitHub/ })).toBeVisible();
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
  await chooseModel(page, "fake/echo");
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

/**
 * Starts a code session on the fake that opens a pull request, and waits for it to show and for
 * the turn that opened it to end, so a message sent next starts at once instead of waiting
 * behind it (#495).
 */
const sessionWithPullRequest = async (page: Page, subject: string) => {
  await page.goto("/workspaces/side-project");
  await chooseModel(page, "fake/echo");
  await page
    .getByLabel("Message", { exact: true })
    .fill(makesPullRequest("Talk into the message box", subject));
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);
  const strip = page.getByRole("region", { name: "Branch and pull request" });
  await expect(strip.getByRole("link", { name: /^PR #\d+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  return strip;
};

// Reviewing a session's pull request in Courtyard (#160): on this worker the fake GitHub's e2e
// check runs, passes or fails as each commit's subject says.
test("the owner reviews a session's pull request file by file, asks for a change, and merges it once its checks pass", async ({
  page,
  request,
}) => {
  await signIn(request);
  // Main's build, once it's merged: still running, so Update Courtyard would wait for it (#186).
  await page.route("**/api/live", (route) =>
    route.fulfill({
      json: {
        kind: "live",
        running: { commit: "a".repeat(40), title: "a1b2c3d The running version" },
        newest: { commit: "b".repeat(40), title: "bbbbbbb Hold to talk" },
        newerOnMain: true,
        lastUpdate: null,
        waiting: null,
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
  await expect(merged.getByRole("button", { name: "Update Courtyard" })).toBeEnabled();
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
  await page.getByLabel("Message", { exact: true }).fill("One more thing");
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

// The setup card (#181, #323): Side project's repository has none of what Matt Pocock's setup
// skill writes, so its Home offers it, once signed in, as a row of Needs you that opens one card,
// every line filled in, and Set up opens a pull request (#301).
test("the setup card says what moves the repository to the house standard, and Set up opens a pull request", async ({
  page,
  request,
}) => {
  await signIn(request);

  await page.goto("/workspaces/side-project");
  const offer = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem", { name: "Add Matt's setup to this repo?" });
  await expect(offer).toContainText("things to set up");
  await offer.getByRole("button", { name: "Review" }).click();
  const card = page.getByRole("dialog", { name: "Set up Matt Pocock's skills" });
  await expect(card.getByRole("region", { name: "Matt's files" })).toContainText(
    "issue-tracker.md · triage-labels.md · domain.md",
  );
  await expect(card.getByRole("region", { name: "Agent skills section" })).toContainText(
    "Added to AGENTS.md",
  );
  await expect(card.getByRole("region", { name: "Triage labels" })).toContainText("needs-triage");
  // Side project has its Paper file, and no tracker or glossary of its own: no line for them.
  await expect(card.getByRole("region", { name: "Paper file" })).toHaveCount(0);
  await expect(card.getByRole("region", { name: "Where work lives" })).toHaveCount(0);
  await card.getByRole("button", { name: "Set up · opens a pull request" }).click();

  await expect(card).toBeHidden();
  const done = page.getByRole("region", { name: "Matt's setup" });
  await expect(done.getByRole("link", { name: /^pull request #\d+$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(offer).toHaveCount(0);

  await request.post("/api/github/sign-out", { data: {} });
});

// The setup card on Workbench (#323; Paper, "Tablet · Setup card with Paper file line"): its own
// tracker, which its instructions say another agent writes, so Keep is recommended with why; its
// glossary as CONTEXT.md, Rename recommended; the Agent skills section; and a Paper file to make.
// It's only opened and closed here, so Workbench's Home stays as the tests below expect.
for (const [device, viewport] of [
  ["tablet", { width: 950, height: 712 }],
  ["cover", { width: 400, height: 900 }],
  ["desktop", { width: 1440, height: 900 }],
] as const) {
  test.describe(`the setup card on the ${device}`, () => {
    test.use({ viewport, ...(device === "desktop" ? {} : { hasTouch: true, isMobile: true }) });

    test("shows every line filled in, the house standard recommended, and a tap changes one", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto("/workspaces/workbench");
      await page
        .getByRole("region", { name: "Needs you" })
        .getByRole("listitem", { name: "Add Matt's setup to this repo?" })
        .getByRole("button", { name: "Review" })
        .click();
      const card = page.getByRole("dialog", { name: "Set up Matt Pocock's skills" });

      const tracker = card.getByRole("region", { name: "Where work lives" });
      await expect(tracker).toContainText("docs/backlog.md");
      await expect(tracker.getByRole("radio", { name: "Keep" })).toBeChecked();
      await expect(tracker).toContainText(
        "Recommended: the repo says another agent writes this file",
      );
      const glossary = card.getByRole("region", { name: "Glossary" });
      await expect(glossary).toContainText("CONTEXT.md");
      await expect(glossary.getByRole("radio", { name: "Rename to GLOSSARY.md" })).toBeChecked();
      await expect(card.getByRole("region", { name: "Agent skills section" })).toContainText(
        "Added to AGENTS.md",
      );
      const paperLine = card.getByRole("region", { name: "Paper file" });
      await expect(paperLine).toContainText("None yet · optional");
      await expect(
        paperLine.getByRole("radio", { name: "Create · Workbench, 4 pages" }),
      ).toBeChecked();
      // Its work stays in its tracker, so no labels are made on GitHub, until Move is tapped.
      await expect(card.getByRole("region", { name: "Triage labels" })).toHaveCount(0);
      await expect(
        card.getByRole("button", { name: "Set up · opens a pull request" }),
      ).toBeInViewport();
      await shot(page, `${device}-setup-card`);
      expect(await pageScrollsSideways(page)).toBe(false);

      await tracker.getByText("Move to GitHub issues").click();
      await expect(tracker.getByRole("radio", { name: "Move to GitHub issues" })).toBeChecked();
      await expect(card.getByRole("region", { name: "Triage labels" })).toBeVisible();
      await card.getByRole("button", { name: "Close" }).click();
      await expect(card).toBeHidden();

      await request.post("/api/github/sign-out", { data: {} });
    });
  });
}

/**
 * Starts a code session through the API whose fake model commits with `subject` (its checks as the
 * subject says) and a description of these paragraphs, and pushes, which opens its pull request:
 * the session's id, once the workspace's list has the pull request.
 */
const pullRequestFrom = async (
  request: APIRequestContext,
  subject: string,
  description: readonly string[] = [],
  /** The files it changes, each with the subject as its one line. */
  files: readonly string[] = ["talk.md"],
) => {
  const messages = [subject, ...description].map((part) => `-m "${part}"`).join(" ");
  const started = await request.post("/api/workspaces/side-project/sessions", {
    data: {
      text: [
        ...files.map((file) => `edit file ${file}: ${subject}`),
        `run command: git add ${files.join(" ")}`,
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
  // Its thumb is the thin one, scrolled down its top fades under the file's name, and nothing in
  // it scrolls the window, which would show the window's own wide scrollbar (#420).
  expect(await lines.evaluate((box) => getComputedStyle(box).scrollbarWidth)).toBe("thin");
  await expect(lines).toHaveAttribute("data-fade", "top");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    ),
  ).toBe(0);
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

  // A button shows it's working (#330; Paper, "Desktop · PR page: quick questions, merging").
  test("Merge on a slow merge says it's merging, in full colour, and takes no second tap", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await pullRequestFrom(request, "Say it's merging [e2e passes]");
    let merges = 0;
    await page.route("**/merge", async (route) => {
      merges += 1;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });

    await page.goto("/workspaces/side-project#prs");
    await page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Say it's merging/ })
      .getByRole("link", { name: /^Review/ })
      .click();
    const review = page.getByRole("region", { name: "Review" });
    const merge = review.getByRole("button", { name: "Merge", exact: true });
    await expect(merge).toBeEnabled();
    const colour = await merge.evaluate((button) => getComputedStyle(button).backgroundColor);
    await merge.click();

    const merging = review.getByRole("button", { name: "Merging…" });
    await expect(merging).toBeVisible();
    await expect(merging).toHaveAttribute("aria-busy", "true");
    await expect(merging).not.toBeDisabled();
    // Its colour at rest, not hovered.
    await page.mouse.move(0, 0);
    expect(await merging.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(
      colour,
    );
    await expect(review.getByRole("button", { name: "Close PR" })).toBeDisabled();
    await merging.click();

    await expect(page.getByRole("region", { name: "Merged" })).toContainText("Merged into main");
    expect(merges).toBe(1);
    await request.post("/api/github/sign-out", { data: {} });
  });

  // Quick questions (#327; Paper, "Desktop · PR page: quick questions, merging"): asked on the
  // page, read-only, beside the file list and the diff; Fix it in a session starts one.
  test("the PRs list shows every open pull request, and quick questions on one no session opened open beside the diff, starting a session only to fix", async ({
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

    // The first question opens the conversation on the page, with no session and no new page.
    await review.getByRole("button", { name: "Can this be merged?" }).click();
    const panel = review.getByRole("region", { name: "Quick questions" });
    await expect(panel).toContainText("reads the PR, changes nothing");
    await expect(panel).toContainText("You asked: Can this be merged?");
    await expect(page).toHaveURL(/\/workspaces\/side-project#pr-\d+$/);
    await expect(review.getByRole("navigation", { name: "Changed files" })).toBeVisible();
    await expect(review.getByRole("region", { name: "What changed" })).toBeVisible();
    await expect(review.getByRole("button", { name: "Merge", exact: true })).toBeVisible();

    // A follow-up in the same ask line; a line an answer points at shows marked in the diff.
    const ask = review.getByRole("textbox", { name: "Ask about this PR" });
    await expect(ask).toHaveAttribute("placeholder", "Ask a follow-up…");
    await ask.fill("Where? point at builds.md line 1");
    await review.getByRole("button", { name: "Ask", exact: true }).click();
    await panel.getByRole("button", { name: "builds.md · line 1" }).click();
    await expect(review.locator("[data-marked]")).toContainText(
      "Builds take turns across the whole PC",
    );
    await shot(page, "pr-quick-questions-desktop");

    // × closes it; it opens again with what was asked.
    await panel.getByRole("button", { name: "Close quick questions" }).click();
    await expect(panel).toHaveCount(0);
    await review.getByRole("button", { name: "Quick questions", exact: true }).click();
    await expect(panel).toContainText("You asked: Can this be merged?");

    // Fix it in a session shows what starts before it starts: on its branch, with its model.
    await review.getByRole("button", { name: "Fix it in a session" }).click();
    const start = review.getByRole("region", { name: "Start a session" });
    await expect(start).toContainText("306-machine-lock");
    await expect(start).toContainText("carrying the quick questions over");
    await start.getByRole("button", { name: "Start the session" }).click();

    await expect(page).toHaveURL(/\/sessions\/[\w-]+$/);
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      /The owner asked about pull request #\d+ on its page/,
    );
    await page.goto("/workspaces/side-project#prs");
    await expect(row).toContainText("from the session");

    await request.post("/api/github/sign-out", { data: {} });
  });

  // Owner rule (2026-10-12): nothing jumps in. While GitHub answers, the PR page is its title and
  // faint rows in the shape of the page, no spinner and no words; coming back shows it at once.
  test("the PR page keeps its place while GitHub answers, and shows at once on the way back", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await page.goto("/workspaces/side-project#prs");
    const review = page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Builds queue across the whole PC/ })
      .getByRole("link", { name: /^Review/ });
    const address = await review.getAttribute("href");

    // Its review, asked for by its number, or through its session once one has opened it.
    const isReview = (url: URL) =>
      /\/workspaces\/side-project\/pull-requests\/\d+$|\/sessions\/[^/]+\/pull-request$/.test(
        url.pathname,
      );
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(isReview, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(address ?? "");
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText(/^#\d+/);
    await expect(page.locator("main [data-placeholder]").first()).toBeVisible();
    await expect(page.getByText("Asking GitHub")).toHaveCount(0);
    const before = await title.boundingBox();

    release();
    const whatChanged = page.getByRole("region", { name: "What changed" });
    await expect(whatChanged).toContainText("Builds take turns across the whole PC");
    await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
    expect((await title.boundingBox())?.y).toBe(before?.y);

    // GitHub answers slowly from now on: the way back mustn't wait for it.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route(isReview, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.continue();
    });
    await page.getByRole("link", { name: "All PRs" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Side project" })).toBeVisible();
    await review.click();
    await expect(whatChanged).toContainText("Builds take turns across the whole PC", {
      timeout: 2000,
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
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

  // #329: a PR page no session opened loaded once, so Merge stayed greyed out after its checks
  // passed, and tapping it said nothing.
  test("a PR page no session opened follows its checks, and Merge says why it waits when tapped", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await page.goto("/workspaces/side-project#prs");
    await page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /The page follows its checks/ })
      .getByRole("link", { name: /^Review/ })
      .click();
    const review = page.getByRole("region", { name: "Review" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /^#\d+ The page follows its checks/,
    );
    await expect(review.getByText("Checks running", { exact: true })).toBeVisible();
    const merge = review.getByRole("button", { name: "Merge", exact: true });
    await expect(merge).toBeDisabled();

    // Tapped while it waits, it says why beside it, and merges nothing.
    await merge.click({ force: true });
    await expect(review.getByRole("status", { name: "Why Merge waits" })).toHaveText(
      "Merge waits for e2e to finish.",
    );

    // The fake's checks pass while the page is open: it follows them with no reload.
    await expect(review.getByText("Checks passed", { exact: true })).toBeVisible();
    await expect(merge).toBeEnabled();
    await expect(review.getByRole("status", { name: "Why Merge waits" })).toHaveCount(0);

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
    // Both measured at once, until the page has settled: on CI it can still be laying out (#401).
    const other = await checks.elementHandle();
    await expect
      .poll(() =>
        branch.evaluate(
          (element, other) =>
            (other as Element).getBoundingClientRect().left - element.getBoundingClientRect().right,
          other,
        ),
      )
      .toBeGreaterThanOrEqual(0);
    await request.post("/api/github/sign-out", { data: {} });
  });

  // #496: a green bump waits for the owner's one tap, never merging itself.
  test("Dependabot's bump whose checks passed says it's from Dependabot, with Merge", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await page.goto("/workspaces/side-project#prs");
    const row = page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /Bump home-assistant/ });
    await expect(row).toContainText("from Dependabot");

    await page.goto("/workspaces/side-project");
    const ready = page
      .getByRole("region", { name: "Needs you" })
      .getByRole("listitem", { name: /Bump home-assistant/ });
    await expect(ready).toContainText("From Dependabot · checks passed");
    await expect(ready.getByRole("button", { name: /^Merge/ })).toBeVisible();
    // Tapping the row opens the PR page.
    await expect(ready.getByRole("link", { name: /Bump home-assistant/ })).toHaveAttribute(
      "href",
      /#pr-\d+$/,
    );
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

  // #501: with a failed check, its merge reason a second line of the status, the files and diff
  // spilled out of their box, under the ask line and Merge / Close PR, and the page scrolled.
  test("with a failed check and many files, the files and diff end above the ask line and Merge, and only they scroll", async ({
    page,
    request,
  }) => {
    await signIn(request);
    const id = await pullRequestFrom(
      request,
      "Bump the routine group",
      SLOTS_DESCRIPTION,
      Array.from({ length: 16 }, (_, i) => `bump-${i + 1}.md`),
    );
    await page.goto(`/workspaces/side-project/sessions/${id}?view=review`);
    const review = page.getByRole("region", { name: "Review" });
    await expect(review).toContainText("Merge waits for");
    const heading = page.getByRole("heading", { level: 1 });
    const whatChanged = review.getByRole("region", { name: "What changed" });
    const files = review.getByRole("navigation", { name: "Changed files" });
    const diff = review.getByRole("region", { name: /^Diff of / });
    const ask = review.getByRole("textbox", { name: "Ask about this PR" });
    const merge = review.getByRole("button", { name: "Merge", exact: true });
    const close = review.getByRole("button", { name: "Close PR" });
    await expect(files).toContainText("16 files");

    for (const shown of [heading, whatChanged, files, diff, ask, merge, close]) {
      await expect(shown).toBeInViewport({ ratio: 1 });
    }
    expect((await pageScroll(page)).scrolls).toBe(false);
    const edges = (shown: typeof files) =>
      shown.evaluate((box) => {
        const { top, bottom } = box.getBoundingClientRect();
        return { top, bottom };
      });
    const quick = review.getByRole("button", { name: "Why did the check fail?" });
    const askTop = Math.min((await edges(ask)).top, (await edges(quick)).top);
    expect((await edges(files)).bottom).toBeLessThanOrEqual(askTop);
    expect((await edges(diff)).bottom).toBeLessThanOrEqual(askTop);
    expect((await edges(ask)).bottom).toBeLessThanOrEqual((await edges(merge)).top);
    // The tree scrolls inside its own box, rather than running on below it.
    expect(
      await files.locator(":scope > div").evaluate((box) => box.scrollHeight > box.clientHeight),
    ).toBe(true);
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

  // Quick questions on a tablet (#327; Paper, "Tablet · PR page: quick questions"): they take the
  // file list's place beside the diff, the list folding into a switcher. #279: what the page sends
  // a session went to the workspace's first session, not the PR's own.
  test("quick questions take the file list's place beside the diff, and Fix it in a session goes to the session that opened it", async ({
    page,
    request,
  }) => {
    await signIn(request);
    const first = await pullRequestFrom(request, "Rail spacing [e2e running]");
    const second = await pullRequestFrom(
      request,
      "Loading states [e2e running]",
      [],
      ["talk.md", "notes.md"],
    );
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

    // A quick ask opens the conversation in the file list's place; the diff stays in view.
    const review = page.getByRole("region", { name: "Review" });
    const ask = page.getByRole("textbox", { name: "Ask about this PR" });
    const files = review.getByRole("navigation", { name: "Changed files" });
    const switcher = review.getByRole("combobox", { name: "Choose a file" });
    await expect(files).toBeVisible();
    await expect(switcher).toHaveCount(0);
    await review.getByRole("button", { name: "Explain this change" }).click();
    const panel = review.getByRole("region", { name: "Quick questions" });
    await expect(panel).toContainText("You asked: Explain this change");
    await expect(files).toHaveCount(0);
    await expect(review.getByRole("region", { name: "What changed" })).toHaveCount(0);
    await expect(review.getByRole("region", { name: /^Diff of / })).toBeVisible();
    await expect(review.getByRole("button", { name: "Merge", exact: true })).toBeVisible();
    await expect(review).toContainText("1 of 2 files");
    await switcher.selectOption("talk.md");
    await expect(review.getByRole("region", { name: "Diff of talk.md" })).toBeVisible();
    await expect(review).toContainText("2 of 2 files");

    // A follow-up goes in the same line; × brings the file list back.
    await expect(ask).toHaveAttribute("placeholder", "Ask a follow-up…");
    await ask.fill("Why two files?");
    await review.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(panel).toContainText("You asked: Why two files?");
    await expect(ask).toHaveValue("");
    await shot(page, "pr-quick-questions-tablet");
    await panel.getByRole("button", { name: "Close quick questions" }).click();
    await expect(files).toBeVisible();

    // Fix it in a session carries the conversation over to the pull request's own session.
    await review.getByRole("button", { name: "Fix it in a session" }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${second}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(secondTitle);
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "Owner: Why two files?",
    );
    await page.goto(`/workspaces/side-project/sessions/${first}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(firstTitle);
    await expect(page.getByText("Owner: Why two files?")).toHaveCount(0);

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

// New repo (#391; Paper, "Tablet · New workspace, Code: New repo"): it heads the repo list, and its
// card fills in what it can: the repo's name from what it's for, private, the owner's account and
// a Paper file, then what it starts with. Only the tablet's makes one, so the rest stay as they are.
for (const [device, viewport] of [
  ["tablet", { width: 950, height: 712 }],
  ["cover", { width: 400, height: 900 }],
  ["desktop", { width: 1440, height: 900 }],
] as const) {
  test.describe(`New repo on the ${device}`, () => {
    test.use({ viewport, ...(device === "desktop" ? {} : { hasTouch: true, isMobile: true }) });

    test(
      device === "tablet"
        ? "fills in what it can from what it's for, and Create makes the repo and its workspace"
        : "fills in what it can from what it's for, all of it shown before Create",
      async ({ page, request }) => {
        await signIn(request);
        await page.goto("/new-workspace");
        const kind = page.getByRole("group", { name: "Kind" });
        await kind.locator("label", { has: page.getByRole("radio", { name: "Code" }) }).click();
        const repos = page.getByRole("group", { name: "Repo" });
        const newRepo = repos.locator("label").first();
        await expect(newRepo).toContainText("New repo");
        await expect(newRepo).toContainText("On the house standard");
        await newRepo.click();

        await page
          .getByRole("textbox", { name: "What's it for?" })
          .fill("Track servicing for both bikes: parts, intervals and shop visits");
        const name = page.getByRole("textbox", { name: "Repo name" });
        await expect(name).toHaveValue("servicing-bikes");
        await name.fill("bike-servicing");
        const card = page.getByRole("region", { name: "New repo" });
        await expect(card.getByRole("button", { name: "Private" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(card).toContainText("octo-owner");
        await expect(card.getByRole("button", { name: "Paper file · 4 pages" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(card).toContainText("No stack yet: Grill on Next up picks it");
        const create = page.getByRole("button", { name: "Create bike-servicing" });
        await expect(create).toBeVisible();
        await shot(page, `${device}-new-repo`);
        expect(await pageScrollsSideways(page)).toBe(false);

        if (device === "tablet") {
          await create.click();
          await expect(page).toHaveURL(/\/workspaces\/bike-servicing$/);
          await expect(
            page.getByRole("heading", { level: 1, name: "Bike Servicing" }),
          ).toBeVisible();
          // Its Paper file was made and connected with it.
          await expect(page.getByRole("button", { name: /Paper · Bike Servicing/ })).toBeVisible();
          await page.goto("/new-workspace");
          await kind.locator("label", { has: page.getByRole("radio", { name: "Code" }) }).click();
          await expect(repos.getByRole("radio", { name: /^bike-servicing/ })).toBeDisabled();
        }

        await request.post("/api/github/sign-out", { data: {} });
      },
    );
  });
}

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

  // Quick questions on the phone (#327; Paper, "Cover · PR page: quick questions sheet"): a sheet
  // over the diff with its own ask line; Merge and Close PR come back when it closes.
  test("quick questions rise as a sheet over the diff, with their own ask line", async ({
    page,
    request,
  }) => {
    await signIn(request);
    await pullRequestFrom(request, "A sheet of questions [e2e running]");
    await page.goto("/workspaces/side-project#prs");
    await page
      .getByRole("region", { name: /^Pull requests/ })
      .getByRole("listitem", { name: /A sheet of questions/ })
      .getByRole("link", { name: /^Review/ })
      .click();

    const review = page.getByRole("region", { name: "Review" });
    const merge = review.getByRole("button", { name: "Merge", exact: true });
    await expect(merge).toBeVisible();
    await review.getByRole("button", { name: "Explain this change" }).click();
    const sheet = review.getByRole("region", { name: "Quick questions" });
    await expect(sheet).toContainText("You asked: Explain this change");
    await expect(sheet).toBeInViewport();
    await expect(merge).toHaveCount(0);
    await expect(review.getByRole("button", { name: "Close PR" })).toHaveCount(0);
    // Its ask line is the only one, inside the sheet.
    await expect(page.getByRole("textbox", { name: "Ask about this PR" })).toHaveCount(1);
    await sheet.getByRole("textbox", { name: "Ask about this PR" }).fill("And the tests?");
    await sheet.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(sheet).toContainText("You asked: And the tests?");
    expect(await pageScrollsSideways(page)).toBe(false);
    await shot(page, "pr-quick-questions-cover");

    await sheet.getByRole("button", { name: "Close quick questions" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(merge).toBeVisible();
    await expect(review.getByRole("button", { name: "Close PR" })).toBeVisible();

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
  const line = page.getByRole("button", { name: /octo-owner\/workbench/ });
  await expect(line).toContainText("No Paper file");
  // Its one line stays in workspace.json, off the page (#333).
  await expect(page.getByText("Plan and code with AI models")).toHaveCount(0);

  const { needsYou, running, nextUp } = blocks(page);
  await expect(needsYou).toContainText(/Needs you · \d+/);
  const ready = needsYou.getByRole("listitem", { name: /Builds take turns/ });
  await expect(ready).toContainText("Checks passed · ready to merge");
  await expect(ready.getByRole("button", { name: /^Merge/ })).toBeVisible();
  // Nothing runs yet: its block keeps its place with one quiet line (#283, #335).
  await expect(running).toContainText("Nothing running");

  // The next in order needs grilling, so Grill is on top (#363); under it the first of the ready
  // issues nobody claimed, with Build; then only the next few titles and the way to the Roadmap,
  // which has the rest (#532).
  await expect(nextUp).toContainText("4 · Code workspaces");
  const grill = nextUp.getByRole("region", { name: "Grill #117" });
  await expect(grill).toContainText("Sub-agents for code review");
  await expect(grill).toContainText("Needs grilling first");
  await expect(nextUp.getByRole("region", { name: "Build #197" })).toContainText(
    "The rail on desktop",
  );
  await nextUpIsSlim(page, {
    titles: "One Reply box everywhere · Usage at a glance · Paste images on the Fold",
    more: 10,
  });

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

  // Tabs show once they have something: the Roadmap always (#532), no sessions yet, one pull
  // request.
  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Roadmap", "PRs1"]);
  // A code workspace has no context file, Things or skills on its page (#301).
  await expect(page.getByRole("region", { name: "Context file" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Skills" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
};

/**
 * Next up only starts the next thing (#532; Paper, "Code Home, slim Next up"): no queue of rows
 * and no More, one faint Then line naming the next titles, and Whole roadmap saying how many more.
 */
const nextUpIsSlim = async (page: Page, shows: { titles: string; more: number }) => {
  const { nextUp } = blocks(page);
  await expect(nextUp.getByRole("listitem")).toHaveCount(0);
  await expect(nextUp.getByRole("button", { name: /^More/ })).toHaveCount(0);
  await expect(nextUp.getByText("Then", { exact: true })).toBeVisible();
  await expect(nextUp.getByText(shows.titles, { exact: true })).toBeVisible();
  await expect(nextUp.getByRole("link", { name: /^Whole roadmap/ })).toHaveText(
    `Whole roadmap · ${shows.more} more`,
  );
};

/** The Roadmap's block, and a milestone's row in it, by its title. */
const roadmap = (page: Page) => page.getByRole("region", { name: "Milestones, in build order" });
const milestone = (page: Page, title: string) =>
  roadmap(page).getByRole("listitem", { name: title, exact: true });
/** The issues a milestone shows, by their rows' names: "#197 The rail on desktop, Ready". */
const issuesIn = (row: ReturnType<typeof milestone>) =>
  expect.poll(() =>
    row
      .getByRole("listitem", { name: /^#/ })
      .evaluateAll((rows) => rows.map((each) => each.getAttribute("aria-label"))),
  );

/**
 * The Roadmap (#532; Paper, "Roadmap"): every open milestone in the roadmap's order, Later last;
 * the current one open, its issues in its Build order, each in one plain state, the done one
 * folded; the others folded until tapped.
 */
const roadmapShowsTheOrder = async (page: Page) => {
  await expect(roadmap(page).getByRole("listitem", { name: /^(\d+ · |Later)/ })).toHaveText([
    /^4 · Code workspaces\s*Now\s*5 left/,
    /^5 · Tablet hub and voice\s*2 left/,
    /^Later\s*9 left/,
  ]);
  const current = milestone(page, "4 · Code workspaces");
  await expect(current.getByRole("img", { name: "1 of 6 done" }).first()).toBeAttached();
  await issuesIn(current).toEqual([
    "#117 Sub-agents for code review, To grill",
    "#197 The rail on desktop, Ready",
    "#251 One Reply box everywhere, Ready",
    "#199 Claimed by a helper, Building",
    "#283 Nothing moves once drawn, After One Reply box everywhere",
  ]);
  await expect(current.getByRole("button", { name: /1 done/ })).toBeVisible();
  // The others are folded until tapped.
  const next = milestone(page, "5 · Tablet hub and voice");
  await expect(next.getByRole("listitem")).toHaveCount(0);
  await next.getByRole("button", { name: /^5 · Tablet hub and voice/ }).click();
  await issuesIn(next).toEqual([
    "#66 Usage at a glance, To grill",
    "#255 Paste images on the Fold, Ready",
  ]);
  // The done one shows once its row is tapped.
  await current.getByRole("button", { name: /1 done/ }).click();
  await expect(
    current.getByRole("listitem", { name: "#190 Tabs on the code Home, Done" }),
  ).toBeVisible();
  // Tapping an issue opens its summary and its board.
  await current.getByRole("button", { name: /The rail on desktop/ }).click();
  await expect(current).toContainText("The rail stays on screen on a desktop.");
  await expect(current).toContainText("Board: Desktop · Rail (#197)");
  await expect(current.getByRole("link", { name: "Open #197 on GitHub" })).toBeVisible();
};

/** The page doesn't scroll at all: everything on Home is on one screen. */
const homeFitsOneScreen = async (page: Page) => {
  await expect.poll(async () => (await pageScroll(page)).scrolls).toBe(false);
};

/** Whether `box` is wholly on the screen, between its top and `bottom`. */
const onScreen = async (box: ReturnType<Page["locator"]>, bottom: number) => {
  const at = await box.boundingBox();
  if (at === null) throw new Error("Not on the page");
  return at.y >= 0 && at.y + at.height <= bottom + 0.5;
};

/** A block's rows that scroll inside its card (#335): how far they can, and scrolled to their end. */
const rowsScroll = (block: ReturnType<Page["locator"]>) =>
  block.evaluate((card) => {
    const rows = [...card.querySelectorAll("*")].find(
      (each) => getComputedStyle(each).overflowY === "auto" && each.querySelector("li") !== null,
    );
    if (rows === undefined) return { overflows: false };
    const overflows = rows.scrollHeight > rows.clientHeight + 1;
    rows.scrollTop = rows.scrollHeight;
    return { overflows };
  });

/**
 * Next up as the owner saw it (#418): the first issue ready, with Build, and `count` ready issues
 * in all, so no Grill.
 */
const readyOnly = async (page: Page, count: number) => {
  await page.route("**/api/workspaces/workbench/next-up", async (route) => {
    const response = await route.fetch();
    const { issues } = (await response.json()) as { issues: { ready: boolean }[] };
    const ready = issues.filter((issue) => issue.ready).slice(0, count);
    await route.fulfill({ response, json: { issues: ready } });
  });
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

    // #532: the queue moved to the Roadmap; Next up names what's next and how many more.
    test("with five issues ready, Next up has Build, a Then line of the next three, and Whole roadmap · 1 more", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await readyOnly(page, 5);
      await page.goto(HOME);
      await expect(blocks(page).nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      await shot(page, "desktop-home-five-ready");
      await nextUpIsSlim(page, {
        titles: "One Reply box everywhere · Paste images on the Fold · A later idea 1",
        more: 1,
      });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("the Roadmap tab shows every milestone in order, the current one open, each issue in one plain state (#532)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(`${HOME}#roadmap`);
      const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
      await expect(tabs.getByRole("link", { name: "Roadmap" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await roadmapShowsTheOrder(page);
      await homeFitsOneScreen(page);
      await shot(page, "desktop-roadmap");
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner, 2026-10-15: Next up showed one card while two milestones had issues to grill (#463).
    test("Grill is on the first issue to grill in order, wherever it is, with the first ready under it", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.route("**/api/workspaces/workbench/next-up", async (route) => {
        const response = await route.fetch();
        const { issues } = (await response.json()) as { issues: { number: number }[] };
        const json = { issues: issues.filter((issue) => issue.number !== 117) };
        await route.fulfill({ response, json });
      });
      await page.goto(HOME);
      const { nextUp } = blocks(page);
      const grill = nextUp.getByRole("region").first();
      await expect(grill).toHaveAccessibleName("Grill #66");
      await expect(grill).toContainText("Usage at a glance");
      await expect(nextUp.getByRole("region").nth(1)).toHaveAccessibleName("Build #197");
      await expect(nextUp).toContainText("5 · Tablet hub and voice");
      await expect(
        nextUp.getByText("One Reply box everywhere · Paste images on the Fold · A later idea 1", {
          exact: true,
        }),
      ).toBeVisible();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner, 2026-10-18: GitHub's limit ran out and Next up said Nothing ready to build (#519;
    // Paper, "Tablet · Code Home: Next up can't reach GitHub").
    test("when GitHub refuses the read, Next up keeps the last list, says why and as of when, and doesn't move", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { nextUp } = blocks(page);
      await expect(nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      const before = await nextUp.boundingBox();
      await page.route("**/api/workspaces/workbench/next-up", async (route) => {
        const response = await route.fetch();
        const { issues } = (await response.json()) as { issues: unknown[] };
        const unread = {
          kind: "rate-limited",
          backAt: "2026-10-18T22:13:00.000Z",
          asOf: "2026-10-18T21:52:00.000Z",
        };
        await route.fulfill({ response, json: { issues, unread } });
      });
      await page.goto(HOME);

      await expect(nextUp.getByRole("status")).toHaveText(
        /^GitHub's limit is used up · back at \d{1,2}:\d{2}/,
      );
      // Beside the label, the milestone, as always (#532).
      await expect(nextUp).toContainText("4 · Code workspaces");
      await expect(nextUp).not.toContainText("Nothing ready to build");
      await expect(nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      expect(await nextUp.boundingBox()).toEqual(before);
      await shot(page, "desktop-home-github-refused");

      // With nothing known, the line takes the empty line's place.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/api/workspaces/workbench/next-up", (route) =>
        route.fulfill({ json: { issues: [], unread: { kind: "unreachable", asOf: null } } }),
      );
      await page.goto(HOME);
      await expect(nextUp.getByRole("status")).toHaveText("Can't reach GitHub");
      await expect(nextUp).not.toContainText("Nothing ready to build");
      await expect(nextUp).not.toContainText("As of");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner rule (2026-10-12): nothing jumps in late. What loads after the page shows the last
    // answer known at once on a revisit, asked for again quietly.
    test("coming back to a code workspace shows its pull requests at once, while they're asked for again", async ({
      page,
      request,
    }) => {
      await signIn(request);
      // The first visit: the list keeps its place, and nothing above it moves when it comes.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/workspaces/workbench/pull-requests", async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`${HOME}#prs`);
      const list = page.getByRole("region", { name: /^Pull requests/ });
      await expect(list.locator("[data-placeholder]")).toBeVisible();
      const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
      const [tabsBefore, listBefore] = [await tabs.boundingBox(), await list.boundingBox()];
      release();
      const row = list.getByRole("listitem", { name: /Builds take turns/ });
      await expect(row).toBeVisible();
      expect(await tabs.boundingBox()).toEqual(tabsBefore);
      expect((await list.boundingBox())?.y).toBe(listBefore?.y);
      await page.unrouteAll({ behavior: "ignoreErrors" });

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

    test("Home fits one screen, and Whole roadmap opens the Roadmap", async ({ page, request }) => {
      await signIn(request);
      await showsHome(page);
      await homeFitsOneScreen(page);
      await shot(page, "tablet-home");

      // Next up's cards, Then line and Whole roadmap all show, nothing scrolling inside it.
      const { nextUp } = blocks(page);
      await expect(nextUp.getByRole("link", { name: /^Whole roadmap/ })).toBeInViewport({
        ratio: 1,
      });
      await nextUp.getByRole("link", { name: /^Whole roadmap/ }).click();
      await expect(page).toHaveURL(/#roadmap$/);
      await roadmapShowsTheOrder(page);
      await homeFitsOneScreen(page);
      await shot(page, "tablet-roadmap");
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Reported from the Fold (#335): with seven rows in Needs you the page scrolled, the title and
    // tabs went out of view and Main went under the message box.
    test("with more in Needs you than fits, the page stays one screen and the rows scroll inside its card (#335)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.route("**/api/workspaces/workbench/pull-requests", async (route) => {
        const response = await route.fetch();
        const { pullRequests } = (await response.json()) as {
          pullRequests: { pullRequest: { number: number; title?: string } }[];
        };
        const [ready] = pullRequests;
        if (ready === undefined) throw new Error("No pull request to copy");
        const more = Array.from({ length: 6 }, (_, at) => ({
          ...ready,
          pullRequest: { ...ready.pullRequest, number: 900 + at, title: `Ready ${at + 1}` },
        }));
        await route.fulfill({ response, json: { pullRequests: [...pullRequests, ...more] } });
      });
      await page.goto(HOME);
      const { needsYou } = blocks(page);
      await expect(needsYou.getByRole("listitem", { name: /Ready 6/ })).toHaveCount(1);
      await homeFitsOneScreen(page);

      // Everything round the blocks is on the screen, and Main ends above the message box.
      const box = page.getByRole("textbox", { name: "Message" });
      const boxTop = (await box.boundingBox())?.y ?? 0;
      const height = page.viewportSize()?.height ?? 0;
      expect(
        await onScreen(page.getByRole("heading", { level: 1, name: "Workbench" }), height),
      ).toBe(true);
      expect(await onScreen(page.getByRole("navigation", { name: "Workspace tabs" }), height)).toBe(
        true,
      );
      expect(await onScreen(page.getByRole("region", { name: "Main" }), boxTop)).toBe(true);
      expect(await onScreen(box, height)).toBe(true);

      // Needs you's rows scroll inside its card, under its heading, which stays put.
      expect((await rowsScroll(needsYou)).overflows).toBe(true);
      await expect(needsYou.getByRole("listitem", { name: /Ready 6/ })).toBeInViewport();
      await expect(needsYou.getByRole("heading", { name: /Needs you/ })).toBeInViewport();
      await homeFitsOneScreen(page);
      await shot(page, "tablet-home-long-needs-you");
      await page.unrouteAll({ behavior: "ignoreErrors" });
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
          text: "run command: git merge main (for: Bring the reply box up to date)",
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
      const approval = needsYou.getByRole("listitem", { name: "Run git merge main?" });
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

    // #398: a block's size is set by the layout, never by its rows. Needs you and Running share the
    // column evenly, full or empty, and rows past that scroll inside.
    test("Needs you and Running keep an even share of the column, however full", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { needsYou, running } = blocks(page);
      const heights = async (): Promise<[number, number]> => [
        (await needsYou.boundingBox())?.height ?? 0,
        (await running.boundingBox())?.height ?? 0,
      ];
      await expect(running).toBeVisible();
      const [calmNeeds, calmRunning] = await heights();
      expect(Math.abs(calmNeeds - calmRunning)).toBeLessThanOrEqual(2);

      const asks = await request.post("/api/workspaces/workbench/sessions", {
        data: {
          text: "run command: git merge main (for: Bring the reply box up to date)",
          model: { provider: "fake", model: "echo" },
        },
      });
      expect(asks.status()).toBe(201);
      const working = [((await asks.json()) as { id: string }).id];
      for (const name of ["Activity lines", "Swipe between photos", "Paste on the Fold"]) {
        const works = await request.post("/api/workspaces/workbench/sessions", {
          data: {
            text: `${name} ${"word ".repeat(900)}`,
            model: { provider: "fake", model: "echo" },
          },
        });
        working.push(((await works.json()) as { id: string }).id);
      }

      await expect(running.getByRole("listitem").nth(2)).toBeAttached({ timeout: 45_000 });
      const approval = needsYou.getByRole("listitem", { name: "Run git merge main?" });
      await expect(approval).toContainText("asked", { timeout: 45_000 });
      await expect(approval).toBeInViewport({ ratio: 1 });
      await expect(running.getByRole("listitem").first()).toBeInViewport({ ratio: 1 });
      const [busyNeeds, busyRunning] = await heights();
      // Full, the same even share as when calm: the rows scroll inside, never stretch their block.
      expect(Math.abs(busyNeeds - busyRunning)).toBeLessThanOrEqual(2);
      await shot(page, "tablet-home-fixed-blocks");

      for (const id of working)
        await request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });
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
      // #398: each block is the same fixed height, whatever it holds; the page scrolls between them.
      const tall = await Promise.all(
        Object.values(blocks(page)).map(async (block) => (await block.boundingBox())?.height ?? 0),
      );
      expect(Math.max(...tall) - Math.min(...tall)).toBeLessThanOrEqual(2);
      await shot(page, "cover-home");
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("with five issues ready, Next up has Build, a Then line and Whole roadmap (#532)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await readyOnly(page, 5);
      await page.goto(HOME);
      const { nextUp } = blocks(page);
      await expect(nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      await nextUp.scrollIntoViewIfNeeded();
      await shot(page, "cover-home-five-ready");
      await nextUpIsSlim(page, {
        titles: "One Reply box everywhere · Paste images on the Fold · A later idea 1",
        more: 1,
      });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("the Roadmap is one column, and nothing scrolls sideways (#532)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(`${HOME}#roadmap`);
      await roadmapShowsTheOrder(page);
      expect(await pageScrollsSideways(page)).toBe(false);
      await shot(page, "cover-roadmap");
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

    test("Grill shows the issue and its model first, then starts a grilling session on it (#363)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const grill = blocks(page).nextUp.getByRole("region", { name: "Grill #117" });
      await grill.getByRole("button", { name: "Grill" }).click();
      await expect(grill).toContainText("A new session grills it with Fake (echoes you)");
      await grill.getByRole("button", { name: "Start grilling" }).click();

      await expect(page).toHaveURL(/\/workspaces\/workbench\/sessions\/[\w-]+$/);
      await expect(page.getByRole("list", { name: "Session" })).toContainText(
        'Grill issue #117, "Sub-agents for code review"',
      );
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
