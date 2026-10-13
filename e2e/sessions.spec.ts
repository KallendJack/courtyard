import { expect, test } from "@playwright/test";
import { openTab } from "./workspace-page.ts";

test("the owner starts a session, watches the answer stream in, and finds it again later", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");

  await page.getByLabel("Message", { exact: true }).fill("Where should the rack go?");
  await page.getByRole("button", { name: "Start" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
  await expect(session).toContainText("You said: Where should the rack go?");

  // Reopening the session shows everything it recorded.
  await page.reload();
  await expect(session).toContainText("Where should the rack go?");
  await expect(session).toContainText("You said: Where should the rack go?");

  // A failed turn says why, with a retry.
  await page.getByLabel("Message", { exact: true }).fill("please fail");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText("failed on purpose");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(session.getByRole("alert")).toHaveCount(2);

  await page.getByRole("link", { name: "Back to Garage gym" }).click();
  await openTab(page, "Sessions");
  // By its first line, or the title a model gave it after the first answer.
  await expect(page.getByRole("region", { name: "Sessions" })).toContainText(
    /where should the rack go/i,
  );
});

test("the owner sees which files the model read", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message", { exact: true }).fill("please read the context file first");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("list", { name: "What the model did" })).toHaveText(
    "Read CONTEXT.md",
  );
});

test("what the model writes between what it does shows apart, between its activities, live and on reopening", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await page
    .getByLabel("Message", { exact: true })
    .fill("write: Now the contract.\nread file: docs/notes.md\nwrite: Good, it's imported.");
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });

  const inOrder = async () => {
    // Each piece of text a paragraph of its own, never run together with the next.
    const before = session.getByText("Now the contract.", { exact: true });
    const did = session.getByRole("list", { name: "What the model did" });
    const after = session.getByText("Good, it's imported.", { exact: true });
    await expect(before).toBeVisible();
    await expect(did).toHaveText("Read docs/notes.md");
    await expect(after).toBeVisible();
    const [first, middle, last] = await Promise.all(
      [before, did, after].map(async (each) => (await each.boundingBox())?.y ?? Number.NaN),
    );
    expect(first).toBeLessThan(middle ?? Number.NaN);
    expect(middle).toBeLessThan(last ?? Number.NaN);
  };

  await inOrder();
  await page.reload();
  await inOrder();
});

test("a new session takes the model's title once its first answer is in", async ({ page }) => {
  // A message of its own, so the test can run again on the same worker.
  const stamp = Date.now();
  const message = `plan the garage lighting ${stamp} please`;
  const titled = `Plan The Garage Lighting ${stamp}`;
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(`You said: ${message}`);

  // The fake titles a session with the first few words of its message, in title case.
  await expect(page.getByRole("heading", { level: 1, name: titled, exact: true })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent in Garage gym" });
  await expect(recent.getByRole("link", { name: titled, exact: true })).toBeVisible();
});

// Owner rule (2026-10-12): nothing jumps in. A session's conversation keeps its place with faint
// rows until its events have come, and coming back to it shows it at once.
test("a session's conversation keeps its place until it comes, and shows at once on coming back", async ({
  page,
}) => {
  const message = `chalk the bar ${Date.now()}`;
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText(`You said: ${message}`);
  const address = page.url();

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sessions/*/events*", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(address);
  const title = page.getByRole("heading", { level: 1 });
  await expect(page.locator("main [data-placeholder]").first()).toBeVisible();
  const before = await title.boundingBox();
  release();
  await expect(session).toContainText(`You said: ${message}`);
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  expect((await title.boundingBox())?.y).toBe(before?.y);

  // The stream opens slowly from now on: the way back mustn't wait for it.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/sessions/*/events*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });
  await page.getByRole("link", { name: "Back to Garage gym" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();
  await page.goBack();
  await expect(session).toContainText(`You said: ${message}`, { timeout: 2000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Owner rule (2026-10-12): nothing jumps in. The sidebar's recent sessions keep their place with
// faint rows the first time, and coming back to a workspace shows them at once.
test("the sidebar's recent sessions keep their place, and show at once on coming back", async ({
  page,
}) => {
  const message = `rack the plates ${Date.now()}`;
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message", { exact: true }).fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(`You said: ${message}`);

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The page's own list comes at once; the sidebar's, asked for once the page shows, is held.
  let asked = 0;
  await page.route("**/api/workspaces/garage-gym/sessions", async (route) => {
    asked += 1;
    if (asked > 1) await held;
    await route.continue();
  });
  await page.goto("/workspaces/garage-gym");
  const recent = page.getByRole("region", { name: "Recent in Garage gym" });
  await expect(recent.locator("[data-placeholder]")).toBeVisible();
  release();
  const link = recent.getByRole("link", { name: /Rack The Plates|rack the plates/ });
  await expect(link).toBeVisible();
  await expect(recent.locator("[data-placeholder]")).toHaveCount(0);

  // The worker answers slowly from now on: the way back mustn't wait for it.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/api/workspaces/garage-gym/sessions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });
  const workspaces = page.getByRole("navigation", { name: "Workspaces" });
  await workspaces.getByRole("link", { name: "Reading list" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reading list" })).toBeVisible();
  await workspaces.getByRole("link", { name: "Garage gym" }).click();
  await expect(link).toBeVisible({ timeout: 2000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
