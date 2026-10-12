import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { openTab } from "./workspace-page.ts";

// Which session is waiting (#345): a workspace's tile on Home names it, and its session list marks
// it and puts it first, so the owner never hunts for it. Mark all read sees every new reply there.
// All of it reads what the worker says each session waits on the owner for.

const FAKE = { provider: "fake", model: "echo" };

type Listed = { id: string; title: string; waiting: string };

const listOf = async (request: APIRequestContext, workspace: string) => {
  const list = await request.get(`/api/workspaces/${workspace}/sessions`);
  return ((await list.json()) as { sessions: Listed[] }).sessions;
};

/**
 * Starts a session on the fake and waits for its answer, a new reply, and its title (the fake's is
 * the message in capitals).
 */
const answered = async (request: APIRequestContext, workspace: string, text: string) => {
  const started = await request.post(`/api/workspaces/${workspace}/sessions`, {
    data: { text, model: FAKE },
  });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await expect
    .poll(async () => (await listOf(request, workspace)).find((session) => session.id === id))
    .toMatchObject({ waiting: "reply", title: expect.stringMatching(/^[A-Z][a-z]* [A-Z]/) });
  return id;
};

/**
 * Waits until the worker has the session titled `title` as seen. A session's page says so once its
 * turns have loaded, so a test that leaves as soon as the heading shows would sometimes beat it
 * (#354).
 */
const seen = async (request: APIRequestContext, workspace: string, title: string) => {
  await expect
    .poll(async () => (await listOf(request, workspace)).find((s) => s.title === title)?.waiting)
    .toBe("nothing");
};

const madeWorkspace = async (request: APIRequestContext) => {
  const name = `Mountain biking ${Date.now()}`;
  const made = await request.post("/api/workspaces", { data: { name } });
  expect(made.status()).toBe(201);
  return { name, id: ((await made.json()) as { id: string }).id };
};

const tile = (page: Page, name: string) =>
  page.getByRole("main").getByRole("list", { name: "Workspaces" }).getByRole("link", { name });

const sessionRows = (page: Page) =>
  page.getByRole("region", { name: "Sessions" }).getByRole("listitem");

const newReplyMark = (page: Page) => page.getByRole("img", { name: "New reply" });

test.use({ viewport: { width: 1440, height: 900 } });

test("a tile names the newest session waiting, and the list marks them and puts them first", async ({
  page,
  request,
}) => {
  const workspace = await madeWorkspace(request);
  const quiet = await request.post(`/api/workspaces/${workspace.id}/sessions`, {
    data: { text: "Fork service", model: FAKE },
  });
  expect(quiet.status()).toBe(201);
  const quietId = ((await quiet.json()) as { id: string }).id;
  await expect
    .poll(async () => (await listOf(request, workspace.id)).find((s) => s.id === quietId)?.waiting)
    .toBe("reply");
  // Seen: it waits on nobody, and is the newest of all until the others answer.
  await page.goto(`/workspaces/${workspace.id}/sessions/${quietId}`);
  await expect
    .poll(async () => (await listOf(request, workspace.id)).find((s) => s.id === quietId)?.waiting)
    .toBe("nothing");
  await answered(request, workspace.id, "Brake pads");
  await answered(request, workspace.id, "Saturday shops");

  await page.goto("/");
  await expect(tile(page, workspace.name)).toContainText("New reply · Saturday Shops and 1 more");
  await tile(page, workspace.name).click();
  await expect(page.getByRole("heading", { level: 1, name: workspace.name })).toBeVisible();
  await openTab(page, "Sessions");
  await expect(sessionRows(page)).toHaveCount(3);
  await expect(sessionRows(page).nth(0)).toContainText("Saturday Shops");
  await expect(
    sessionRows(page)
      .nth(0)
      .filter({ has: newReplyMark(page) }),
  ).toBeVisible();
  await expect(sessionRows(page).nth(1)).toContainText("Brake Pads");
  await expect(
    sessionRows(page)
      .nth(1)
      .filter({ has: newReplyMark(page) }),
  ).toBeVisible();
  await expect(
    sessionRows(page)
      .nth(2)
      .filter({ has: newReplyMark(page) }),
  ).toHaveCount(0);

  // Opened, it's seen: one waits, and its tile opens it.
  await sessionRows(page).nth(0).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: "Saturday Shops" })).toBeVisible();
  await seen(request, workspace.id, "Saturday Shops");
  await page.goto("/");
  await expect(tile(page, workspace.name)).toContainText("New reply · Brake Pads");
  await expect(tile(page, workspace.name)).not.toContainText("more");
  await tile(page, workspace.name).click();
  await expect(page.getByRole("heading", { level: 1, name: "Brake Pads" })).toBeVisible();
  await seen(request, workspace.id, "Brake Pads");
  await page.goto(`/workspaces/${workspace.id}`);
  await openTab(page, "Sessions");
  await expect(sessionRows(page).filter({ has: newReplyMark(page) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
});

test("Mark all read sees every new reply in the workspace", async ({ page, request }) => {
  const workspace = await madeWorkspace(request);
  await answered(request, workspace.id, "Brake pads");
  await answered(request, workspace.id, "Saturday shops");

  await page.goto(`/workspaces/${workspace.id}`);
  await openTab(page, "Sessions");
  await expect(sessionRows(page).filter({ has: newReplyMark(page) })).toHaveCount(2);
  await page.getByRole("button", { name: "Mark all read" }).click();

  await expect(sessionRows(page).filter({ has: newReplyMark(page) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark all read" })).toHaveCount(0);
  expect((await listOf(request, workspace.id)).map((session) => session.waiting)).toEqual([
    "nothing",
    "nothing",
  ]);
  await page.goto("/");
  await expect(tile(page, workspace.name)).not.toContainText("New reply");
});

test.describe("on a tablet", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("the rail's tile counts the sessions waiting, and Mark all read clears it", async ({
    page,
    request,
  }) => {
    const workspace = await madeWorkspace(request);
    await answered(request, workspace.id, "Brake pads");
    await answered(request, workspace.id, "Saturday shops");
    const railTile = page
      .getByRole("navigation", { name: "Workspaces" })
      .getByRole("link", { name: workspace.name });

    await page.goto(`/workspaces/${workspace.id}`);
    await expect(railTile).toHaveText(`${workspace.name}2`);
    await openTab(page, "Sessions");
    await page.getByRole("button", { name: "Mark all read" }).click();

    await expect(railTile).toHaveText(workspace.name);
  });
});
