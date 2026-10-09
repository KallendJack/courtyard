import { expect, test } from "@playwright/test";

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
