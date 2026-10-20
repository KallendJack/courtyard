import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { openTab } from "./workspace-page.ts";

// A builder waiting on you (#541; Paper, "Tablet · Code Home: builders wait until answered",
// "Tablet · Sessions: waiting stays until answered", "Tablet · Session: question pinned"): its
// question in Needs you, answered with one tap; pinned above the session's reply box until the
// owner sends; a failed turn's Continue, and a stop's Open. The worker's side is in
// waiting-on-you.test.ts. The fake asks with "ask owner: <question> | <choice> | <choice>".

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** Starts a session in Side project on the fake, as the owner, and returns its id. */
const startCoding = async (request: APIRequestContext, text: string) => {
  const response = await request.post("/api/workspaces/side-project/sessions", {
    data: { text, model: { provider: "fake", model: "echo" } },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** What the session waits on the owner for, as Side project's list says. */
const waitingOf = async (request: APIRequestContext, id: string) => {
  const response = await request.get("/api/workspaces/side-project/sessions");
  const { sessions } = (await response.json()) as {
    sessions: { id: string; waiting: string }[];
  };
  return sessions.find((session) => session.id === id)?.waiting;
};

test("a question with choices is answered with one tap from Needs you", async ({
  page,
  request,
}) => {
  const id = await startCoding(
    request,
    "ask owner: Which board is the agreed one? | The Agreed one | The Drafts one",
  );
  await expect.poll(() => waitingOf(request, id)).toBe("asked");
  await page.setViewportSize({ width: 950, height: 712 });
  await page.goto("/workspaces/side-project");

  const row = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem", { name: "Which board is the agreed one?" });
  await expect(row).toContainText(/asks · \d{1,2}:\d\d/);
  await expect(row.getByRole("button")).toHaveText(["The Agreed one", "The Drafts one"]);
  await shot(page, "tablet-code-home-question");
  await row.getByRole("button", { name: "The Drafts one" }).click();

  await expect(row).toHaveCount(0);
  await expect.poll(() => waitingOf(request, id)).not.toBe("asked");
  await page.goto(`/workspaces/side-project/sessions/${id}`);
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("Asked you: Which board is the agreed one?");
  await expect(session).toContainText("You said: The Drafts one");
});

test("the question stays pinned above the reply box, whatever's read, until the owner sends", async ({
  page,
  request,
}) => {
  const id = await startCoding(request, "ask owner: Which search should I use?");
  await expect.poll(() => waitingOf(request, id)).toBe("asked");
  await page.setViewportSize({ width: 950, height: 712 });
  await page.goto(`/workspaces/side-project/sessions/${id}`);

  const pinned = page.getByRole("region", { name: "Waiting on you" });
  await expect(pinned).toContainText("Which search should I use?");
  await expect(pinned).toContainText("Waiting on you · stays until you send a reply");
  await shot(page, "tablet-session-question-pinned");
  // Reading it never clears it.
  await page.reload();
  await expect(pinned).toBeVisible();
  expect(await waitingOf(request, id)).toBe("asked");

  await page.getByLabel("Message", { exact: true }).fill("The one in the issue");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: The one in the issue",
  );
  await expect(pinned).toHaveCount(0);
});

test("a builder's failed turn offers Continue, a stop Open, and Sessions groups them in gold", async ({
  page,
}) => {
  const failed = "5d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6";
  const stopped = "6e2f3a4b-5c6d-4e7f-9081-92b3c4d5e6f7";
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  const builder = (id: string, title: string, waiting: string) => ({
    id,
    workspaceId: "toolshed",
    title,
    createdAt: at,
    updatedAt: at,
    busy: false,
    byLead: true,
    now: { kind: "your-turn" },
    waiting,
    seen: true,
    queued: false,
    branch: `courtyard/${id.slice(0, 8)}`,
  });
  // Toolshed's sessions as the worker gives them: one builder failed, one stopped with no PR.
  await page.route("**/api/workspaces/toolshed/sessions", (route) =>
    route.fulfill({
      json: {
        running: 0,
        sessions: [
          builder(failed, "Build #510: Fold bugs", "turn-failed"),
          builder(stopped, "Build #454: Ideas ranked", "stopped"),
        ],
      },
    }),
  );
  let continued: unknown;
  await page.route(`**/api/sessions/${failed}/continue`, async (route) => {
    continued = route.request().postDataJSON();
    await route.fulfill({ status: 202, body: "" });
  });
  await page.setViewportSize({ width: 950, height: 712 });
  await page.goto("/workspaces/toolshed");

  const needs = page.getByRole("region", { name: "Needs you" });
  const failedRow = needs.getByRole("listitem", { name: "Build #510: Fold bugs" });
  await expect(failedRow).toContainText(/Failed · \d{1,2}:\d\d( [AP]M)? · seen/);
  const stoppedRow = needs.getByRole("listitem", { name: "Build #454: Ideas ranked" });
  await expect(stoppedRow).toContainText(/Stopped, no PR · \d{1,2}:\d\d( [AP]M)? · seen/);
  await expect(stoppedRow.getByRole("link", { name: "Open Build #454: Ideas ranked" })).toBeVisible();
  await shot(page, "tablet-code-home-failed-and-stopped");
  await failedRow.getByRole("button", { name: "Continue Build #510: Fold bugs" }).click();
  await expect.poll(() => continued).toEqual({});

  await openTab(page, "Sessions");
  const group = page.getByRole("region", { name: "Waiting on you" });
  await expect(group.getByRole("heading")).toHaveText("Waiting on you · 2");
  await expect(group).toContainText("Stay until you answer · Mark all read leaves them");
  await expect(group).toContainText("Failed · seen");
  await expect(group).toContainText("Stopped, no PR · seen");
  await expect(group).not.toContainText("Your turn");
  await shot(page, "tablet-sessions-waiting-on-you");
});
