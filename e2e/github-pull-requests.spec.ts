import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { shot, signIn } from "./github.ts";
import { pageScroll, pageScrollsSideways } from "./page-scroll.ts";

// A code workspace's PRs list and PR page on each screen (#278), and making a code workspace on a
// repo, against the fake GitHub start-worker.mjs gives the worker.

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
