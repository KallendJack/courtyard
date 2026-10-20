import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CUT_OFF_SESSION_ID, CUT_OFF_SESSION_TITLE } from "./cut-off-session.ts";
import { openTab } from "./workspace-page.ts";

// A turn a restart cut off (#186; Paper, "Tablet · Session: turn cut off, Continue" and
// "Component · Cut-off turn: cover, desktop, push"): the worker finds it as it starts, the session
// says so with what it was doing, and Continue carries it on; Start again is under ⋯. Needs you
// offers Continue too. The worker's side is in outlive.test.ts.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const SESSION = `/workspaces/reading-list/sessions/${CUT_OFF_SESSION_ID}`;

test("a cut-off turn says when and what it was doing, and Continue carries it on", async ({
  page,
}) => {
  // Its workspace's History lists it, to open again (#565).
  await page.setViewportSize({ width: 950, height: 712 });
  await page.goto("/workspaces/reading-list");
  await openTab(page, "History");
  await page
    .getByRole("region", { name: "Sessions" })
    .getByRole("link", { name: new RegExp(CUT_OFF_SESSION_TITLE) })
    .click();
  await expect(page).toHaveURL(new RegExp(`${SESSION}$`));
  const card = page.getByRole("region", { name: "Cut off" });
  await expect(card).toContainText(/^Cut off · Courtyard restarted at \d{1,2}:\d\d/);
  await expect(card).toContainText(
    "It stopped while reading CONTEXT.md. Continue picks up from there and checks what already happened.",
  );
  await shot(page, "tablet-session-cut-off");

  // On the cover screen, its buttons go under its words.
  await page.setViewportSize({ width: 400, height: 900 });
  await expect(card).toContainText(/^Cut off · restarted at \d{1,2}:\d\d/, { useInnerText: true });
  const words = await card.getByText(/^It stopped while/).boundingBox();
  const button = await card.getByRole("button", { name: "Continue" }).boundingBox();
  expect(button?.y ?? 0).toBeGreaterThan((words?.y ?? 0) + (words?.height ?? 0) - 1);
  await shot(page, "cover-session-cut-off");

  await page.setViewportSize({ width: 1440, height: 900 });
  // Start again, the old Retry, is under ⋯.
  await card.getByRole("button", { name: "More for this turn" }).click();
  const menu = page.getByRole("dialog", { name: "This turn" });
  await expect(menu.getByRole("button", { name: /^Start again/ })).toContainText(
    "Sends your message again, from scratch",
  );
  await shot(page, "desktop-session-cut-off-menu");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await card.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Courtyard restarted while you were working on your last turn",
  );
  // The cut-off turn is no longer the last: it says so, and offers nothing.
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Sort the list into this month and later")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: CUT_OFF_SESSION_TITLE })).toBeVisible();
});

test("Needs you offers Continue for a session a restart cut off", async ({ page }) => {
  const id = "7c2e9a10-4b3d-4e8f-a1c5-9d0b6e2f3a47";
  const at = new Date(Date.now() - 5 * 60_000).toISOString();
  // Toolshed's sessions as the worker gives them: one, cut off.
  await page.route("**/api/workspaces/toolshed/sessions", (route) =>
    route.fulfill({
      json: {
        running: 0,
        sessions: [
          {
            id,
            workspaceId: "toolshed",
            title: "Slim new-session screen",
            createdAt: at,
            updatedAt: at,
            busy: false,
            now: { kind: "your-turn" },
            waiting: "cut-off",
            queued: false,
          },
        ],
      },
    }),
  );
  let continued: unknown;
  await page.route(`**/api/sessions/${id}/continue`, async (route) => {
    continued = route.request().postDataJSON();
    await route.fulfill({ status: 202, body: "" });
  });
  await page.setViewportSize({ width: 950, height: 712 });
  await page.goto("/workspaces/toolshed");

  const row = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem")
    .filter({ hasText: "Slim new-session screen" });
  await expect(row).toContainText(/Cut off at \d{1,2}:\d\d( [AP]M)? · Courtyard restarted/);
  await shot(page, "tablet-code-home-cut-off");
  await row.getByRole("button", { name: "Continue Slim new-session screen" }).click();
  await expect.poll(() => continued).toEqual({});
});
