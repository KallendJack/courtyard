import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import { chooseModel } from "./frame.ts";

// Code sessions (#170, ADR 0007), in the Side project code workspace start-worker.mjs sets up. The
// fake edits a file with "edit file <path>: <line>" and runs a command with "run command: …"
// (saying what it's for with a closing "(for: …)"), each only as the worker, or the owner's
// approval (#171), allows, and "update the task list" updates its task list (ADR 0025).

/** Starts a session in Side project, on the fake, with `lines` as its message. */
const startOnPage = async (page: Page, lines: readonly string[]) => {
  await page.goto("/workspaces/side-project");
  await chooseModel(page, "fake/echo");
  // Exactly: a session another test left here can have "message" in its Rename button's name.
  await page.getByLabel("Message", { exact: true }).fill(lines.join("\n"));
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);
};

/** Starts a session in Side project on the fake, as the owner, and returns its id. */
const startCoding = async (request: APIRequestContext, text: string) => {
  const response = await request.post("/api/workspaces/side-project/sessions", {
    data: { text, model: { provider: "fake", model: "echo" } },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** The approval card a waiting turn shows (#171). */
const approvalOn = (page: Page) => page.getByRole("region", { name: "Needs your OK" });

test("a code session's edits and commands show as it works, and anything off the allowlist waits for the owner", async ({
  page,
}) => {
  await startOnPage(page, [
    "update the task list",
    "edit file notes.md: The rack goes on the back wall",
    "run command: git add notes.md",
    "run command: git diff --cached --name-only",
    "run command: rm -rf node_modules",
  ]);
  await approvalOn(page).getByRole("button", { name: "Deny" }).click();

  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    const activities = page.getByRole("list", { name: "What the model did" });
    await expect(activities.getByRole("listitem")).toHaveText([
      "Updated the task list",
      "Edited notes.md",
      "Ran git add notes.md",
      "Ran git diff --cached --name-only",
    ]);
    const session = page.getByRole("list", { name: "Session" });
    // What the command printed, from the session's own worktree.
    await expect(session).toContainText("Ran git diff --cached --name-only: notes.md");
    await expect(session).toContainText(
      "Couldn't run rm -rf node_modules: The owner denied that command, so it didn't run.",
    );
    await expect(approvalOn(page)).toHaveCount(0);
  }
});

test("an approval shows the exact command and why, Allow runs it, and the card goes on every open device", async ({
  page,
  context,
}) => {
  await startOnPage(page, ["run command: git --version (for: To check which git runs here)"]);
  const card = approvalOn(page);
  await expect(card).toContainText("Run a command? It isn't on the allowlist.");
  await expect(card.getByRole("code")).toHaveText("git --version");
  await expect(card).toContainText(
    "To check which git runs here. Deny and it will find another way.",
  );
  // The same session, open on another device.
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(approvalOn(other)).toBeVisible();

  await card.getByRole("button", { name: "Allow", exact: true }).click();

  for (const each of [page, other]) {
    await expect(approvalOn(each)).toHaveCount(0);
    await expect(
      each.getByRole("list", { name: "What the model did" }).getByRole("listitem"),
    ).toHaveText(["Ran git --version"]);
    await expect(each.getByRole("list", { name: "Session" })).toContainText(
      "Ran git --version: git version",
    );
  }
});

test("Allow always for this workspace runs it, the workspace's sessions don't ask again, and Allowed commands removes it (#185)", async ({
  page,
  request,
}) => {
  await startOnPage(page, ["run command: git stash list (for: To see what's stashed)"]);
  const card = approvalOn(page);
  // Exactly what it would allow, before the tap: the command's leading words.
  const always = card.getByRole("group", { name: "Always allow git stash …" });
  await expect(always).toContainText("Always allow git stash …");

  await always.getByRole("button", { name: "This workspace" }).click();

  await expect(approvalOn(page)).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "What the model did" }).getByRole("listitem"),
  ).toHaveText(["Ran git stash list"]);
  // Another session in the workspace runs it, with other words after them, without asking.
  const other = await startCoding(request, "run command: git stash show --stat");
  await page.goto(`/workspaces/side-project/sessions/${other}`);
  await expect(
    page.getByRole("list", { name: "What the model did" }).getByRole("listitem"),
  ).toHaveText(["Ran git stash show --stat"]);
  await expect(approvalOn(page)).toHaveCount(0);

  // Workspace ⋯ → Allowed commands lists it, from the session it was allowed in, to Remove.
  await page.goto("/workspaces/side-project");
  await page.getByRole("button", { name: "Workspace options" }).click();
  await page.getByRole("button", { name: /^Allowed commands/ }).click();
  const sheet = page.getByRole("dialog", { name: "Allowed commands · Side project" });
  const listed = sheet.getByRole("list", { name: "Allowed commands" }).getByRole("listitem");
  await expect(listed).toHaveCount(1);
  await expect(listed).toContainText("git stash …");
  await expect(listed).toContainText("from ");
  await sheet.getByRole("button", { name: "Remove git stash …" }).click();
  await expect(sheet).toContainText("Nothing yet.");

  // Removed, it asks again.
  await startOnPage(page, ["run command: git stash list"]);
  await expect(approvalOn(page)).toBeVisible();
  await approvalOn(page).getByRole("button", { name: "Deny" }).click();
});

test("running what's in a folder git ignores asks first, saying why (#219)", async ({ page }) => {
  await startOnPage(page, [
    "edit file .gitignore: test-results/",
    "run command: pnpm -C test-results/ci test (for: To run the downloaded checks)",
  ]);
  const card = approvalOn(page);
  await expect(card).toContainText(
    "Run a command? It runs in a folder git ignores (downloaded or built files).",
  );
  await expect(card.getByRole("code").first()).toHaveText("pnpm -C test-results/ci test");
  for (const [name, size] of [
    ["tablet", { width: 950, height: 712 }],
    ["cover", { width: 400, height: 900 }],
    ["desktop", { width: 1440, height: 900 }],
  ] as const) {
    await page.setViewportSize(size);
    await card.scrollIntoViewIfNeeded();
    const folder = process.env.COURTYARD_E2E_SHOTS;
    if (folder !== undefined) {
      await page.screenshot({ path: join(folder, `${name}-approval-ignored-folder.png`) });
    }
  }
  await card.getByRole("button", { name: "Deny" }).click();
  await expect(approvalOn(page)).toHaveCount(0);
});

/** Whether an element's text takes one line: no taller than its line height. */
const takesOneLine = (each: Locator) =>
  each.evaluate(
    (element) =>
      element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight),
  );

/** Text far too long for one line on any screen. */
const LONG = "The activity line keeps to one line however much the model wrote. ".repeat(12);

// Activity lines stay one line (#285): commands people recognise get a plain summary instead of
// their arguments, and anything else is cut to one line, on the unfolded Fold. The e2e worker's
// `gh` is a stand-in that never reaches GitHub (start-worker.mjs).
test.describe("activity lines on the unfolded Fold", () => {
  test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

  /**
   * The sessions a test started: the fake is still writing back their long messages after the
   * test, holding code session slots, so they're stopped at the end.
   */
  const started: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of started.splice(0)) {
      await request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });
    }
  });

  /** Opens a new session that runs `commands`, and returns its activities. */
  const activitiesFor = async (page: Page, request: APIRequestContext, commands: string[]) => {
    const id = await startCoding(
      request,
      commands.map((each) => `run command: ${each}`).join("\n"),
    );
    started.push(id);
    await page.goto(`/workspaces/side-project/sessions/${id}`);
    return page.getByRole("list", { name: "What the model did" }).getByRole("listitem");
  };

  test("commits, pushes, pull requests and issues show in plain words, and any other command as it is, each on one line", async ({
    page,
    request,
  }) => {
    const unknown = `git log --oneline --grep "${LONG}"`;
    // "[e2e passes]": a failed check on the pull request the push opens would start another turn,
    // holding a code session slot after the test.
    const lines = await activitiesFor(page, request, [
      `git commit --allow-empty -m "Activity lines stay one line [e2e passes]" -m "${LONG}" -m "${LONG}"`,
      "git push -u origin HEAD",
      `gh pr create --title "Activity lines stay one line" --body "${LONG}"`,
      `gh issue create --title "Activity lines are too long" --body "${LONG}" -l bug,needs-triage -m Later`,
      `gh issue comment 79 --body "${LONG}"`,
      unknown,
    ]);

    await expect(lines).toHaveText([
      "Committed “Activity lines stay one line [e2e passes]”",
      "Pushed the branch",
      "Opened PR “Activity lines stay one line”",
      "Filed “Activity lines are too long”",
      "Commented on #79",
      `Ran ${unknown}`,
    ]);
    for (const line of await lines.all()) expect(await takesOneLine(line)).toBe(true);
  });

  test("editing a pull request with a long body shows as Updated PR and its number, on one line", async ({
    page,
    request,
  }) => {
    const line = await activitiesFor(page, request, [
      `gh pr edit 275 --title "One line" --body "${LONG}"`,
    ]);
    // Not the session's own pull request, so it waits for the owner.
    await approvalOn(page).getByRole("button", { name: "Allow", exact: true }).click();

    await expect(line).toHaveText("Updated PR #275");
    expect(await takesOneLine(line)).toBe(true);
  });
});

/** Where an approval's answer goes. */
const APPROVAL_ANSWERS = "**/api/sessions/*/approvals/*";
const UNREACHABLE = "Courtyard can't reach its worker";

/** Marks the page's body if it ever says the worker can't be reached, however briefly. */
const noteUnreachable = (page: Page) =>
  page.evaluate((words) => {
    new MutationObserver(() => {
      if (document.body.textContent?.includes(words)) document.body.dataset.sawUnreachable = "yes";
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, UNREACHABLE);

test("an answer the worker is slow to take waits for it quietly, never saying it can't be reached (#204)", async ({
  page,
}) => {
  await startOnPage(page, ["run command: git --version"]);
  const card = approvalOn(page);
  await expect(card).toBeVisible();
  await noteUnreachable(page);
  // The first try: the worker too busy to answer in time, so the proxy in front gives up on it.
  let tries = 0;
  await page.route(APPROVAL_ANSWERS, async (route) => {
    tries += 1;
    if (tries > 1) return route.continue();
    await wait(3000);
    return route.fulfill({ status: 502, body: "Bad Gateway" });
  });

  await card.getByRole("button", { name: "Allow", exact: true }).click();

  await expect(card.getByRole("status")).toHaveText("Waiting for Courtyard…");
  await expect(approvalOn(page)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Ran git --version: git version",
  );
  expect(tries).toBe(2);
  await expect(page.locator("body")).not.toHaveAttribute("data-saw-unreachable", "yes");
});

test("an answer given while the worker can't be reached is kept, and goes once it's back (#204)", async ({
  page,
}) => {
  await startOnPage(page, ["run command: git --version"]);
  const card = approvalOn(page);
  await expect(card).toBeVisible();
  await page.route(APPROVAL_ANSWERS, (route) =>
    route.fulfill({ status: 502, body: "Bad Gateway" }),
  );

  await card.getByRole("button", { name: "Allow", exact: true }).click();

  await expect(card.getByRole("alert")).toContainText(UNREACHABLE);
  await page.unroute(APPROVAL_ANSWERS);
  await expect(approvalOn(page)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Ran git --version: git version",
  );
});

test("an answer whose connection is refused says so within moments, and goes once the worker's back (#204)", async ({
  page,
}) => {
  await startOnPage(page, ["run command: git --version"]);
  const card = approvalOn(page);
  await expect(card).toBeVisible();
  let tries = 0;
  await page.route(APPROVAL_ANSWERS, (route) => {
    tries += 1;
    return route.abort("connectionrefused");
  });

  await card.getByRole("button", { name: "Allow", exact: true }).click();

  // Three quick failures in a row, not the 30 seconds a slow worker gets.
  await expect(card.getByRole("alert")).toContainText(UNREACHABLE, { timeout: 5000 });
  expect(tries).toBeGreaterThanOrEqual(3);
  await page.unroute(APPROVAL_ANSWERS);
  await expect(approvalOn(page)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Ran git --version: git version",
  );
});

test("an answer given with the device's network down says so at once, and goes once it's back (#204)", async ({
  page,
  context,
}) => {
  await startOnPage(page, ["run command: git --version"]);
  const card = approvalOn(page);
  await expect(card).toBeVisible();
  let tries = 0;
  page.on("requestfailed", (request) => {
    if (request.url().includes("/approvals/")) tries += 1;
  });
  await context.setOffline(true);

  await card.getByRole("button", { name: "Allow", exact: true }).click();

  // After the first try: no retries first, as there would be for a refused connection.
  await expect(card.getByRole("alert")).toContainText(UNREACHABLE, { timeout: 2000 });
  expect(tries).toBe(1);
  await context.setOffline(false);
  await expect(approvalOn(page)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Ran git --version: git version",
  );
});

test("stopping a turn that waits on an approval ends it, and the card goes", async ({ page }) => {
  await startOnPage(page, ["run command: git --version"]);
  await expect(approvalOn(page)).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByText("You stopped this turn.")).toBeVisible();
  await expect(approvalOn(page)).toHaveCount(0);
});

test("a screenshot of a Paper board shows in the chat, the newest of each board, and opens full size (ADR 0023)", async ({
  page,
}) => {
  await startOnPage(page, [
    'paper create_artboard {"fileId": "file-1", "name": "Board", "styles": {}}',
    'paper get_screenshot {"fileId": "file-1", "nodeId": "fake-1"}',
    'paper get_screenshot {"fileId": "file-1", "nodeId": "fake-1"}',
  ]);

  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    await expect(
      page.getByRole("list", { name: "What the model did" }).getByRole("listitem"),
    ).toHaveText([
      "Used Paper: create_artboard",
      "Used Paper: get_screenshot",
      "Used Paper: get_screenshot",
    ]);
    // Two screenshots of the same board: only the newest shows.
    const shown = page.getByRole("button", { name: "View Paper screenshot.png" });
    await expect(shown).toHaveCount(1);
    await expect(shown.getByRole("img")).toHaveJSProperty("complete", true);
    await shown.click();
    const viewer = page.getByRole("dialog", { name: "Paper screenshot.png" });
    await expect(viewer.getByRole("img", { name: "Paper screenshot.png" })).toBeVisible();
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toBeHidden();
  }
});

test("deleting in Paper what the session didn't make waits for the owner, showing what (ADR 0023)", async ({
  page,
}) => {
  await startOnPage(page, ['paper delete_nodes {"fileId": "file-1", "nodeIds": ["board-7"]}']);
  const card = approvalOn(page);
  await expect(card).toContainText("Delete something in Paper this session didn't make?");
  await expect(card.getByRole("code")).toHaveText(
    'delete_nodes {"fileId":"file-1","nodeIds":["board-7"]}',
  );

  await card.getByRole("button", { name: "Deny" }).click();

  await expect(approvalOn(page)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Couldn't use Paper's delete_nodes: The owner denied that, so it didn't happen.",
  );
});

test("a model that can't code is refused in a code workspace, with the reason", async ({
  page,
}) => {
  await page.goto("/workspaces/side-project");
  await chooseModel(page, "fake-two/echo");
  await page.getByLabel("Message", { exact: true }).fill("Fix the build");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Fake two can't code, so it can't work in a code workspace. Pick a model that can.",
  );
  await expect(page).toHaveURL(/\/workspaces\/side-project$/);
});

/** Long enough that the fake is still writing it long after the test is done with it. */
const LONG_TASK = `Refactor ${"the sessions module, the code module and the sidebar, ".repeat(120)}please.`;

/** How many code sessions run at once: the contract's `CODE_SESSIONS_AT_ONCE` (#174, #364). */
const AT_ONCE = 6;

test.describe("several code sessions at once (#174)", () => {
  /** Sessions the test keeps busy, so every place is taken; stopped at the end. */
  const busy: string[] = [];

  /** Stops a session's first turn. */
  const stopFirstTurn = (request: APIRequestContext, id: string) =>
    request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });

  test.afterEach(async ({ request }) => {
    for (const id of busy.splice(0)) await stopFirstTurn(request, id);
  });

  /** How many code sessions are running across the worker. */
  const running = async (request: APIRequestContext) => {
    const response = await request.get("/api/workspaces/side-project/sessions");
    return ((await response.json()) as { running: number }).running;
  };

  /**
   * Starts busy sessions until every place is taken. Counted from the worker, not assumed: a
   * session another test on the worker left waiting for the owner holds a place too (#717).
   */
  const takeEveryPlace = async (request: APIRequestContext) => {
    for (let now = await running(request); now < AT_ONCE; now = await running(request)) {
      busy.push(await startCoding(request, LONG_TASK));
      await expect.poll(() => running(request)).toBeGreaterThan(now);
    }
  };

  test("one more waits, saying why, and starts once one of the others ends", async ({
    page,
    request,
  }) => {
    await takeEveryPlace(request);

    await page.goto("/workspaces/side-project");
    await chooseModel(page, "fake/echo");
    await page.getByLabel("Message", { exact: true }).fill("Fix the build");
    await page.getByRole("button", { name: "Start" }).click();
    // Stopped after the test too, so it's never still running in the next one (#458).
    await page.waitForURL(/\/sessions\/[^/]+$/);
    const started = new URL(page.url()).pathname.split("/").at(-1);
    if (started !== undefined) busy.push(started);

    const session = page.getByRole("list", { name: "Session" });
    await expect(session).toContainText("waiting for a place · 0 ahead");
    await expect(session).not.toContainText("You said:");

    const [first] = busy.splice(0, 1);
    if (first !== undefined) await stopFirstTurn(request, first);

    await expect(session).toContainText("You said: Fix the build");
    await expect(session).not.toContainText("waiting for a place");
  });

  test("the sessions list shows one waiting, which the owner can remove", async ({
    page,
    request,
  }) => {
    await takeEveryPlace(request);
    await startCoding(request, "From session to pull request");

    await page.goto("/workspaces/side-project#sessions");
    const sessions = page.getByRole("region", { name: "Sessions" });
    await expect(sessions).toContainText(`${AT_ONCE} of ${AT_ONCE} code sessions running`);
    const waiting = sessions
      .getByRole("listitem")
      .filter({ hasText: "From session to pull request" });
    await expect(waiting).toContainText("waiting for a place · 0 ahead");

    await waiting.getByRole("button", { name: "Remove" }).click();

    await expect(sessions).not.toContainText("From session to pull request");
  });
});

test("the sidebar lists code workspaces apart from planning ones", async ({ page }) => {
  await page.goto("/");

  const workspaces = page.getByRole("navigation", { name: "Workspaces" });
  // Each may carry a count of what needs the owner, from other tests on the worker.
  await expect(
    workspaces.getByRole("list", { name: "Code workspaces" }).getByRole("link"),
  ).toHaveText([/^Side project/, /^Toolshed/, /^Workbench/]);
  await expect(workspaces.getByRole("list", { name: "Planning workspaces" })).not.toContainText(
    "Side project",
  );
});
