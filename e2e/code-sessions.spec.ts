import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

// Code sessions (#170, ADR 0007), in the Side project code workspace start-worker.mjs sets up. The
// fake edits a file with "edit file <path>: <line>" and runs a command with "run command: …"
// (saying what it's for with a closing "(for: …)"), each only as the worker, or the owner's
// approval (#171), allows.

/** Starts a session in Side project, on the fake, with `lines` as its message. */
const startOnPage = async (page: Page, lines: readonly string[]) => {
  await page.goto("/workspaces/side-project");
  await page.getByLabel("Model").selectOption("fake/echo");
  await page.getByLabel("Message").fill(lines.join("\n"));
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);
};

/** The approval card a waiting turn shows (#171). */
const approvalOn = (page: Page) => page.getByRole("region", { name: "Needs your OK" });

test("a code session's edits and commands show as it works, and anything off the allowlist waits for the owner", async ({
  page,
}) => {
  await startOnPage(page, [
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

  await card.getByRole("button", { name: "Allow" }).click();

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
  await page.getByLabel("Model").selectOption("fake-two/echo");
  await page.getByLabel("Message").fill("Fix the build");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Fake two can't code, so it can't work in a code workspace. Pick a model that can.",
  );
  await expect(page).toHaveURL(/\/workspaces\/side-project$/);
});

/** Long enough that the fake is still writing it long after the test is done with it. */
const LONG_TASK = `Refactor ${"the sessions module, the code module and the sidebar, ".repeat(120)}please.`;

test.describe("several code sessions at once (#174)", () => {
  /** Sessions the test keeps busy, so three code sessions are running; stopped at the end. */
  const busy: string[] = [];

  /** Starts a session in Side project on the fake, as the owner, and returns its id. */
  const startCoding = async (request: APIRequestContext, text: string) => {
    const response = await request.post("/api/workspaces/side-project/sessions", {
      data: { text, model: { provider: "fake", model: "echo" } },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };

  /** Stops a session's first turn. */
  const stopFirstTurn = (request: APIRequestContext, id: string) =>
    request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });

  test.afterEach(async ({ request }) => {
    for (const id of busy.splice(0)) await stopFirstTurn(request, id);
  });

  test("a fourth waits, saying why, and starts once one of the three ends", async ({
    page,
    request,
  }) => {
    for (let started = 0; started < 3; started += 1) {
      busy.push(await startCoding(request, LONG_TASK));
    }

    await page.goto("/workspaces/side-project");
    await page.getByLabel("Model").selectOption("fake/echo");
    await page.getByLabel("Message").fill("Fix the build");
    await page.getByRole("button", { name: "Start" }).click();

    const session = page.getByRole("list", { name: "Session" });
    await expect(session).toContainText(
      "Waiting: 3 code sessions are running already. This starts as soon as one of them ends.",
    );
    await expect(session).not.toContainText("You said:");

    const [first] = busy.splice(0, 1);
    if (first !== undefined) await stopFirstTurn(request, first);

    await expect(session).toContainText("You said: Fix the build");
    await expect(session).not.toContainText("Waiting:");
  });

  test("the sessions list shows one waiting, which the owner can remove", async ({
    page,
    request,
  }) => {
    for (let started = 0; started < 3; started += 1) {
      busy.push(await startCoding(request, LONG_TASK));
    }
    await startCoding(request, "From session to pull request");

    await page.goto("/workspaces/side-project");
    const sessions = page.getByRole("region", { name: "Sessions" });
    await expect(sessions).toContainText("3 of 3 code sessions running");
    const waiting = sessions
      .getByRole("listitem")
      .filter({ hasText: "From session to pull request" });
    await expect(waiting).toContainText("Queued · starts when a slot frees");

    await waiting.getByRole("button", { name: "Remove" }).click();

    await expect(sessions).not.toContainText("From session to pull request");
  });
});

test("the sidebar lists code workspaces apart from planning ones", async ({ page }) => {
  await page.goto("/");

  const workspaces = page.getByRole("navigation", { name: "Workspaces" });
  await expect(
    workspaces.getByRole("list", { name: "Code workspaces" }).getByRole("link"),
  ).toHaveText(["Side project"]);
  await expect(workspaces.getByRole("list", { name: "Planning workspaces" })).not.toContainText(
    "Side project",
  );
});
