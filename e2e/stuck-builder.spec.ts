import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// A Lead's builder stuck (#590; Paper, "Tablet · Code Home: a builder stalled (#474)", its words now
// Stuck and why): a gold row in Needs you, whose Open only opens the kept session. The worker's side is in lead.test.ts.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

test("Needs you shows a stuck builder and why, and Open opens its session", async ({ page }) => {
  const id = "3b8f1c2d-5e6a-4f7b-9c0d-1e2f3a4b5c6d";
  const at = new Date(Date.now() - 40 * 60_000).toISOString();
  // Toolshed's sessions as the worker gives them: one builder, stuck.
  await page.route("**/api/workspaces/toolshed/sessions", (route) =>
    route.fulfill({
      json: {
        running: 0,
        sessions: [
          {
            id,
            workspaceId: "toolshed",
            title: "Build #183: Shared Scroller",
            createdAt: at,
            updatedAt: at,
            busy: false,
            byLead: true,
            now: { kind: "your-turn" },
            waiting: "stuck",
            stuck: "It ended two turns in a row with no pull request and no question.",
            queued: false,
            branch: "courtyard/3b8f1c2d",
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 950, height: 712 });
  await page.goto("/workspaces/toolshed");

  const row = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem")
    .filter({ hasText: "#183 Shared Scroller" });
  await expect(row).toContainText(
    "Stuck · It ended two turns in a row with no pull request and no question.",
  );
  await shot(page, "tablet-code-home-stuck");
  await row.getByRole("link", { name: "Open Build #183: Shared Scroller" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/toolshed/sessions/${id}$`));
});
