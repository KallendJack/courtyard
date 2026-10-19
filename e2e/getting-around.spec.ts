import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

// Getting around (#492, #521): a session's way back as a button, no sessions in the right rail, Home's Needs you
// with everything waiting in every workspace and the mark's gold count, and a session's Next pill
// to the next thing waiting. On the cover screen, the open workspace's tile opens its sessions.
// All of it reads what the worker says waits on the owner.

const FAKE = { provider: "fake", model: "echo" };

type Listed = { id: string; title: string; waiting: string };

const listOf = async (request: APIRequestContext, workspace: string) => {
  const list = await request.get(`/api/workspaces/${workspace}/sessions`);
  return ((await list.json()) as { sessions: Listed[] }).sessions;
};

const madeWorkspace = async (request: APIRequestContext, name: string) => {
  const made = await request.post("/api/workspaces", { data: { name: `${name} ${Date.now()}` } });
  expect(made.status()).toBe(201);
  return (await made.json()) as { id: string; name: string };
};

/** Starts a session on the fake and waits for its answer, a new reply, and its title. */
const answered = async (request: APIRequestContext, workspace: string, text: string) => {
  const started = await request.post(`/api/workspaces/${workspace}/sessions`, {
    data: { text, model: FAKE },
  });
  expect(started.status()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await expect
    .poll(async () => (await listOf(request, workspace)).find((session) => session.id === id))
    .toMatchObject({ waiting: "reply", title: expect.stringMatching(/^[A-Z][a-z]* [A-Z]/) });
  const session = (await listOf(request, workspace)).find((listed) => listed.id === id);
  return { id, title: session?.title ?? "" };
};

const needsYou = (page: Page) => page.getByRole("region", { name: "Needs you" });

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Home's Needs you lists what waits in every workspace, and a row opens it", async ({
    page,
    request,
  }) => {
    const workspace = await madeWorkspace(request, "Mountain biking");
    const pads = await answered(request, workspace.id, "Brake pads");

    await page.goto("/");

    const row = needsYou(page).getByRole("link", {
      name: `Reply · ${pads.title} · ${workspace.name}`,
    });
    await expect(row).toBeVisible();
    // The mark counts them in gold, on every page.
    await expect(page.locator("[data-needs-you-count]")).toHaveText(/^\d+$/);
    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: pads.title })).toBeVisible();
    // Seen, it no longer waits.
    await expect
      .poll(
        async () => (await listOf(request, workspace.id)).find((s) => s.id === pads.id)?.waiting,
      )
      .toBe("nothing");
    await page
      .getByRole("navigation", { name: "Workspaces" })
      .getByRole("link", { name: "Home" })
      .click();
    await expect(needsYou(page).getByRole("link", { name: new RegExp(pads.title) })).toHaveCount(0);
  });

  test("the right rail lists no sessions: it's Model, Skills, Settings and Talk (#521)", async ({
    page,
    request,
  }) => {
    const workspace = await madeWorkspace(request, "Garage");
    const pads = await answered(request, workspace.id, "Brake pads");
    const shops = await answered(request, workspace.id, "Saturday shops");

    await page.goto(`/workspaces/${workspace.id}/sessions/${shops.id}`);

    await expect(page.getByRole("heading", { level: 1, name: shops.title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: pads.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All sessions" })).toHaveCount(0);
  });

  test("a session's way back is a button, a full tap high, to its workspace (#521)", async ({
    page,
    request,
  }) => {
    const workspace = await madeWorkspace(request, "Garage");
    const pads = await answered(request, workspace.id, "Brake pads");

    await page.goto(`/workspaces/${workspace.id}/sessions/${pads.id}`);

    const back = page.getByRole("link", { name: `Back to ${workspace.name}` });
    await expect(back).toHaveText(workspace.name);
    const box = await back.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(40);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}$`));
  });

  test("a session's Next pill opens the next thing waiting elsewhere", async ({
    page,
    request,
  }) => {
    // A code session, whose chip row the pill ends; and a reply waiting elsewhere.
    const build = await answered(request, "side-project", "Wire up the talk key");
    const workspace = await madeWorkspace(request, "Porch");
    await answered(request, workspace.id, "Gate hinges");

    await page.goto(`/workspaces/side-project/sessions/${build.id}`);

    const next = page
      .getByRole("region", { name: "Branch and pull request" })
      .getByRole("link", { name: /^Next · .+ in .+/ });
    await expect(next).toBeVisible();
    await expect(next).not.toHaveAccessibleName(new RegExp(`in ${build.title}$`));
    await next.click();
    await expect(page).not.toHaveURL(new RegExp(build.id));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("on the cover screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 900 } });

  test("tapping the open workspace's tile opens its sessions", async ({ page, request }) => {
    const workspace = await madeWorkspace(request, "Sport");
    const pads = await answered(request, workspace.id, "Brake pads");
    const shops = await answered(request, workspace.id, "Saturday shops");

    await page.goto(`/workspaces/${workspace.id}/sessions/${shops.id}`);
    await page
      .getByRole("navigation", { name: "Workspaces" })
      .getByRole("link", { name: workspace.name })
      .click();

    const sheet = page.getByRole("dialog", { name: workspace.name });
    await expect(sheet.getByRole("link", { name: new RegExp(`^${shops.title}`) })).toContainText(
      "Here",
    );
    await sheet.getByRole("link", { name: new RegExp(`^${pads.title}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: pads.title })).toBeVisible();
    await expect(sheet).toBeHidden();
  });
});
