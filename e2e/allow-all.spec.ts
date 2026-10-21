import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { chooseModel } from "./frame.ts";

// Allow all for this task (#428; Paper, "2 · Agreed": the approval's line, how long, the session's
// strip and marked steps), in start-worker.mjs's Side project, on the fake, which
// runs "run command: …" as the worker or the owner allows. The worker's side is in
// allow-all.test.ts.

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** The three screens the boards are drawn for, by name: the unfolded Fold first. */
const SCREENS = [
  { name: "tablet", width: 950, height: 712 },
  { name: "cover", width: 400, height: 900 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

/** A shot on each screen, back on the unfolded Fold after. */
const shotEach = async (page: Page, name: string) => {
  for (const screen of SCREENS) {
    await page.setViewportSize(screen);
    await shot(page, `${screen.name}-${name}`);
  }
  await page.setViewportSize(SCREENS[0]);
};

/** Starts a session in Side project, on the fake, with `lines` as its message. */
const startOnPage = async (page: Page, lines: readonly string[]) => {
  await page.goto("/workspaces/side-project");
  await chooseModel(page, "fake/echo");
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

const approvalOn = (page: Page) => page.getByRole("region", { name: "Needs your OK" });

test("from an approval: how long, then the turn runs on without asking, each step marked, until Turn off", async ({
  page,
}) => {
  await startOnPage(page, [
    "run command: git stash list (for: To see what's stashed)",
    "run command: git count-objects",
  ]);
  const card = approvalOn(page);
  const line = card.getByRole("button", { name: "Allow all for this task…" });
  await expect(line).toBeVisible();
  await shotEach(page, "approval-allow-all-line");

  await line.click();
  const sheet = page.getByRole("dialog", { name: "Allow all for this task" });
  // Until this task is done is picked first, and the button says exactly what it does.
  await expect(sheet.getByRole("radio", { name: /Until this task is done/ })).toBeChecked();
  await expect(sheet).toContainText("Still asks: edits outside this session's branch");
  await shotEach(page, "allow-all-how-long");
  await sheet.getByText("1 hour", { exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Allow all for 1 hour" })).toBeVisible();
  await sheet.getByText("Until this task is done").click();
  await sheet.getByRole("button", { name: "Allow all until it's done" }).click();

  await expect(sheet).toBeHidden();
  await expect(approvalOn(page)).toHaveCount(0);
  const steps = page.getByRole("list", { name: "What the model did" }).getByRole("listitem");
  await expect(steps).toHaveText([
    "Ran git stash listran under Allow all",
    "Ran git count-objectsran under Allow all",
  ]);
  const strip = page.getByRole("region", { name: "Allowing all" });
  await expect(strip).toContainText(
    /^Allowing all · until the PR opens · (12 h|11 h \d+ min) at most/,
  );
  // No ⋯ to turn it on again while it's on: Turn off first.
  await expect(page.getByRole("button", { name: "Session options" })).toHaveCount(0);
  await shotEach(page, "session-allowing-all");

  // It's on after a reload too, decided by the worker.
  await page.reload();
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "Turn off" }).click();
  await expect(strip).toBeHidden();
  await expect(page.getByRole("button", { name: "Session options" })).toBeVisible();
});

test("from the session's ⋯, for an hour, on a session between turns", async ({ page, request }) => {
  // This one holds no place.
  const id = await startCoding(request, "Tidy the notes");
  await page.goto(`/workspaces/side-project/sessions/${id}`);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Tidy the notes",
  );
  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("button", { name: /^Allow all for this task…/ }).click();
  const sheet = page.getByRole("dialog", { name: "Allow all for this task" });
  await sheet.getByText("1 hour", { exact: true }).click();
  await sheet.getByRole("button", { name: "Allow all for 1 hour" }).click();

  const strip = page.getByRole("region", { name: "Allowing all" });
  await expect(strip).toContainText(/^Allowing all · (59 min|1 h) left/);
  await strip.getByRole("button", { name: "Turn off" }).click();
  await expect(strip).toBeHidden();
});
