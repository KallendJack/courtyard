import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newWorkspace } from "./saving.ts";

// What's new after an Update (#604; Paper, "2 · Agreed", planning workspace row: "Tablet · Home:
// what's new after an Update (#604)"): in New version's row on Home, Updated and the next line
// not yet tapped, "New in Garage: Draw the garage", with Try it, which opens where it's tried and
// says it's been said, so the row goes back to its usual self. The worker reads the lines from the
// merged pull requests (live.test.ts); here the page is given them as the worker gives them.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const RUNNING = { commit: "b".repeat(40), title: "b2c3d4e Draw the garage from Home" };

/**
 * The live copy just updated, on main's newest, with `line` its next what's-new line (or none
 * once it's been tapped), and every tap on Try it recorded in `seen`.
 */
const updatedWith = async (page: Page, line: () => object | null, seen: unknown[]) => {
  await page.route("**/api/live", (route) =>
    route.fulfill({
      json: {
        kind: "live",
        running: RUNNING,
        newest: RUNNING,
        newerOnMain: false,
        lastUpdate: {
          outcome: "updated",
          from: { commit: "a".repeat(40), title: "a1b2c3d The version before" },
          to: RUNNING,
          message: "Updated to b2c3d4e Draw the garage from Home. Courtyard is running.",
          startedAt: "2026-10-21T09:00:00Z",
          finishedAt: "2026-10-21T09:02:00Z",
        },
        build: null,
        waiting: null,
        whatsNew: line(),
      },
    }),
  );
  await page.route("**/api/live/whats-new/seen", (route) => {
    seen.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
};

const row = (page: Page) => page.getByRole("region", { name: "What's new" });

test.describe("on the unfolded Fold", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("after an Update, Home says what's new once, and Try it opens where it's tried", async ({
    page,
  }) => {
    // Its own name, so it never meets draw-the-garage's, run beside it on the same worker.
    const name = `Garage new ${Date.now()}`;
    await newWorkspace(page, name);
    const id = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
    const seen: unknown[] = [];
    await updatedWith(
      page,
      () =>
        seen.length > 0
          ? null
          : {
              pullRequest: 604,
              what: "Draw the garage",
              place: { kind: "workspace", id, name },
            },
      seen,
    );

    await page.goto("/");
    await expect(row(page)).toContainText("Updated");
    await expect(row(page)).toContainText(`New in ${name}: Draw the garage`);
    await shot(page, "whats-new-fold");

    await row(page).getByRole("button", { name: "Try it" }).tap();

    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(seen).toEqual([{ pullRequest: 604 }]);
    // Said once: back on Home, the row is its usual self.
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Up to date" })).toBeVisible();
    await expect(row(page)).toHaveCount(0);
  });

  test("a line tried on Home itself goes where it is", async ({ page }) => {
    const seen: unknown[] = [];
    await updatedWith(
      page,
      () =>
        seen.length > 0
          ? null
          : { pullRequest: 640, what: "A softer fade under the title", place: { kind: "home" } },
      seen,
    );

    await page.goto("/");
    await expect(row(page)).toContainText("New: A softer fade under the title");
    await row(page).getByRole("button", { name: "Try it" }).tap();

    await expect(page.getByRole("region", { name: "Up to date" })).toBeVisible();
    await expect(row(page)).toHaveCount(0);
    expect(seen).toEqual([{ pullRequest: 640 }]);
  });
});

test.describe("on the cover screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 900 } });

  test("the line fits its row, with Try it", async ({ page }) => {
    await updatedWith(
      page,
      () => ({
        pullRequest: 604,
        what: "Draw the garage",
        place: { kind: "workspace", id: "garage", name: "Garage" },
      }),
      [],
    );

    await page.goto("/");
    await expect(row(page)).toContainText("New in Garage: Draw the garage");
    await expect(row(page).getByRole("button", { name: "Try it" })).toBeVisible();
    await shot(page, "whats-new-cover");
  });
});
