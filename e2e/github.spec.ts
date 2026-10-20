import { expect, type Page, test } from "@playwright/test";
import { chooseModel } from "./frame.ts";
import { shot, signIn } from "./github.ts";
import { pageScrollsSideways } from "./page-scroll.ts";

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
// It's only opened and closed here, so Workbench's Home stays as github-code-home.spec.ts expects.
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
