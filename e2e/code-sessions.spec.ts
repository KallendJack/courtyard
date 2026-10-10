import { expect, type Page, test } from "@playwright/test";

// Code sessions (#170, ADR 0007), in the Side project code workspace start-worker.mjs sets up. The
// fake edits a file with "edit file <path>: <line>" and runs a command with "run command: …"
// (saying what it's for with a closing "(for: …)"), each only as the worker, or the owner's
// approval (#171), allows.

/** Starts a session in Side project, on the fake, with `lines` as its message. */
const startCoding = async (page: Page, lines: readonly string[]) => {
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
  await startCoding(page, [
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
  await startCoding(page, ["run command: git --version (for: To check which git runs here)"]);
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
  await startCoding(page, ["run command: git --version"]);
  await expect(approvalOn(page)).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByText("You stopped this turn.")).toBeVisible();
  await expect(approvalOn(page)).toHaveCount(0);
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
