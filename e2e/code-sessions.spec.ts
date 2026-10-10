import { type APIRequestContext, expect, test } from "@playwright/test";

// Code sessions (#170, ADR 0007), in the Side project code workspace start-worker.mjs sets up. The
// fake edits a file with "edit file <path>: <line>" and runs a command with "run command: …",
// each only as the worker allows.

test("a code session's edits and commands show as it works, and anything off the allowlist is refused with the reason", async ({
  page,
}) => {
  await page.goto("/workspaces/side-project");
  await page.getByLabel("Model").selectOption("fake/echo");
  await page
    .getByLabel("Message")
    .fill(
      [
        "edit file notes.md: The rack goes on the back wall",
        "run command: git add notes.md",
        "run command: git diff --cached --name-only",
        "run command: rm -rf node_modules",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);

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
      "Couldn't run rm -rf node_modules: That command isn't on this workspace's command allowlist",
    );
  }
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
