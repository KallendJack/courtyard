import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { OWNER_PASSWORD } from "./owner.ts";

// A new reply (#334): an answer the owner hasn't seen waits on them, on its workspace's tile and
// in a code workspace's Needs you, until they open its session on any device. The worker decides;
// every screen reads what it says.

const FAKE = { provider: "fake", model: "echo" };

/** What the worker says a session waits on the owner for. */
const waitingOf = async (request: APIRequestContext, workspace: string, id: string) => {
  const list = await request.get(`/api/workspaces/${workspace}/sessions`);
  const { sessions } = (await list.json()) as { sessions: { id: string; waiting: string }[] };
  return sessions.find((session) => session.id === id)?.waiting;
};

/** Starts a session in `workspace` on the fake and waits for its answer: a new reply. */
const answered = async (request: APIRequestContext, workspace: string, text: string) => {
  const started = await request.post(`/api/workspaces/${workspace}/sessions`, {
    data: { text, model: FAKE },
  });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await expect.poll(() => waitingOf(request, workspace, id)).toBe("reply");
  return id;
};

/** Once the page has told the worker the owner has seen the session. */
const seenOn = (page: Page, id: string) =>
  page.waitForResponse(
    (response) => response.url().endsWith(`/api/sessions/${id}/seen`) && response.status() === 204,
  );

const tile = (page: Page, name: string) =>
  page.getByRole("main").getByRole("list", { name: "Workspaces" }).getByRole("link", { name });

/** The session's row in a code workspace's Needs you. */
const replyRow = (page: Page, id: string) =>
  page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href$="/sessions/${id}"]`) });

/**
 * Goes to Side project's Home and waits for what its Needs you is made from: its sessions, and
 * on a first visit its pull requests.
 */
const sideProjectHome = async (page: Page, go: () => Promise<unknown>, firstVisit: boolean) => {
  const answer = (path: string) =>
    page.waitForResponse((response) => response.url().endsWith(`/api/workspaces/${path}`));
  const loaded = Promise.all([
    answer("side-project/sessions"),
    ...(firstVisit ? [answer("side-project/pull-requests")] : []),
  ]);
  await go();
  await loaded;
  await expect(page.getByRole("heading", { level: 1, name: "Side project" })).toBeVisible();
};

test.use({ viewport: { width: 1440, height: 900 } });

test("a new reply waits on its tile and in Needs you until the owner opens it, on any device", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const name = `Porch ${Date.now()}`;
  const made = await request.post("/api/workspaces", { data: { name } });
  expect(made.status()).toBe(201);
  const workspace = ((await made.json()) as { id: string }).id;
  const planning = await answered(request, workspace, "Where does the bench go?");
  const coding = await answered(request, "side-project", "Tidy the README");

  await page.goto("/");
  await expect(tile(page, name)).toContainText("New reply · ");
  await page.goto("/workspaces/side-project");
  await expect(replyRow(page, coding)).toBeVisible();

  // Opened here, and back: its row has gone.
  const seenHere = seenOn(page, coding);
  await replyRow(page, coding)
    .getByRole("link", { name: /^Open / })
    .click();
  await seenHere;
  await sideProjectHome(page, () => page.goBack(), false);
  await expect(replyRow(page, coding)).toHaveCount(0);

  // Opened on another device: gone from this one's tile too.
  const { baseURL } = testInfo.project.use;
  const fold = await browser.newContext(baseURL === undefined ? {} : { baseURL });
  const login = await fold.request.post("/api/login", { data: { password: OWNER_PASSWORD } });
  expect(login.ok()).toBe(true);
  const there = await fold.newPage();
  const seenThere = seenOn(there, planning);
  await there.goto(`/workspaces/${workspace}/sessions/${planning}`);
  await seenThere;
  for (const each of [page, there]) {
    await each.goto("/");
    await expect(tile(each, name)).toContainText(/just now|min ago/);
    await expect(tile(each, name)).not.toContainText("New reply");
  }
  await page.reload();
  await expect(tile(page, name)).toContainText(/just now|min ago/);
  await expect(tile(page, name)).not.toContainText("New reply");
  await sideProjectHome(page, () => page.goto("/workspaces/side-project"), true);
  await expect(replyRow(page, coding)).toHaveCount(0);
  await fold.close();

  // A newer answer is a new reply again.
  const sent = await request.post(`/api/sessions/${planning}/messages`, {
    data: { text: "And the planter?", model: FAKE },
  });
  expect(sent.status()).toBe(202);
  await expect.poll(() => waitingOf(request, workspace, planning)).toBe("reply");
  await page.goto("/");
  await expect(tile(page, name)).toContainText("New reply · ");
});
