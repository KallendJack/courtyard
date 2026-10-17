import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Read offline (#106): a device that keeps a copy shows the owner's context and its latest
// sessions, read-only, when the worker can't be reached. The worker going away is played by
// refusing every call to its API, as a machine that's switched off does.

/** Turns Read offline on in Settings, and waits for the first copy to be kept. */
const keepACopy = async (page: Page) => {
  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Read offline" });
  const kept = page.waitForResponse((response) => response.url().endsWith("/api/offline-copy"));
  await card.getByRole("switch", { name: "Keep a copy to read offline" }).click();
  expect((await kept).status()).toBe(200);
  await expect(card).toContainText("Last updated");
  return card;
};

/** The worker can't be reached: every call to its API is refused. */
const workerGoesAway = (page: Page) =>
  page.route("**/api/**", (route) => route.abort("connectionrefused"));

test("with a copy kept, a session and its workspace read offline, with nothing to send", async ({
  page,
}) => {
  const name = `Back wall ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, "save fact: The back wall is 2.4 m wide.");
  const session = page.url();
  const card = await keepACopy(page);
  await expect(card).toContainText(
    "Your context and each workspace's 5 latest conversations are stored on this device.",
  );

  await workerGoesAway(page);
  await page.goto(session);
  const conversation = page.getByRole("list", { name: "Session" });
  await expect(conversation).toContainText("You said:");
  const notes = page.getByRole("list", { name: "Saved to context" });
  await expect(notes).toContainText("The back wall is 2.4 m wide.");
  // Read-only: nothing that needs the worker.
  await expect(notes.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  const offline = page.getByRole("status", { name: "Offline" });
  await expect(offline).toContainText("Offline · reading a copy");
  await expect(offline).toContainText("Last updated");

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("status", { name: "Offline" })).toBeVisible();
  await page.getByRole("link", { name: "What Courtyard knows" }).click();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText(
    "The back wall is 2.4 m wide.",
  );
  await expect(page.getByRole("button", { name: /^Fix:/ })).toHaveCount(0);
});

test("without a copy, a worker that can't be reached shows that it's offline", async ({ page }) => {
  await page.goto("/settings");
  await workerGoesAway(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();
});

test("turning Read offline off wipes the copy", async ({ page }) => {
  const card = await keepACopy(page);
  await card.getByRole("switch", { name: "Keep a copy to read offline" }).click();
  await expect(card).not.toContainText("Last updated");

  await workerGoesAway(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();
});

test("a device logged out from elsewhere wipes its copy when it next reaches Courtyard", async ({
  page,
}) => {
  await keepACopy(page);
  // Logged out from another device: this one hears so the next time it asks.
  await page.route("**/api/auth", (route) => route.fulfill({ json: { state: "logged-out" } }));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.unroute("**/api/auth");
  await workerGoesAway(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();
});
