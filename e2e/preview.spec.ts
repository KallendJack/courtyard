import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// A code session's preview (#183), in the Side project code workspace start-worker.mjs sets up:
// its repository's dev script serves a page on PORT and says where, as Vite does.

const UNFOLDED = { width: 950, height: 712 };
const COVER_SCREEN = { width: 400, height: 640 };

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** A new session in Side project, once its first turn has ended, open on its page. */
const openSession = async (page: Page, text = "Hello") => {
  const response = await page.request.post("/api/workspaces/side-project/sessions", {
    data: { text, model: { provider: "fake", model: "echo" } },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await page.goto(`/workspaces/side-project/sessions/${id}`);
  await expect(page.getByText(/Your turn · finished/)).toBeVisible();
  return id;
};

/** Starts the preview from the session's page, confirming the command the first time it asks. */
const startPreview = async (page: Page) => {
  await page.getByRole("button", { name: "Start preview" }).click();
  const confirm = page.getByRole("region", { name: "Start preview", exact: true });
  if (await confirm.isVisible()) {
    await shot(page, "preview-confirm");
    await expect(confirm).toContainText("npm run dev");
    await confirm.getByRole("button", { name: "Start preview" }).click();
  }
  // Serving, once it's no longer busy starting.
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).not.toHaveAttribute("aria-busy", "true");
};

test.describe("unfolded", () => {
  test.use({ viewport: UNFOLDED });

  test("Start preview runs the dev script as a task once the owner confirms it, and Preview opens the app beside the chat", async ({
    page,
  }) => {
    await openSession(page);
    await expect(page.getByRole("button", { name: "Start preview" })).toBeVisible();
    await shot(page, "preview-start");

    await startPreview(page);

    // It runs as one of the session's tasks, above the Reply box.
    await expect(
      page
        .getByRole("list", { name: "Tasks running" })
        .getByRole("button", { name: /^Task · npm run dev/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const panel = page.getByRole("region", { name: "Preview", exact: true });
    await expect(
      panel.frameLocator("iframe").getByRole("heading", { name: "Side project, running" }),
    ).toBeVisible();
    await expect(panel.getByRole("link", { name: "Open in a tab" })).toHaveAttribute(
      "target",
      "_blank",
    );
    // The chat stays beside it, with its Reply box.
    await expect(page.getByRole("textbox")).toBeVisible();
    await shot(page, "preview-beside-chat");

    await panel.getByRole("button", { name: "Close preview" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("the model's screenshot of the preview shows in the chat", async ({ page }) => {
    const id = await openSession(page);
    await startPreview(page);

    await page.request.post(`/api/sessions/${id}/messages`, {
      data: { text: "preview screenshot: / cover", model: { provider: "fake", model: "echo" } },
    });

    await expect(page.getByText("Preview: Here's / at the cover size")).toBeVisible();
    const shown = page.getByRole("button", { name: "View Preview screenshot.png" });
    await expect(shown).toBeVisible();
  });
});

test.describe("on the cover screen", () => {
  test.use({ viewport: COVER_SCREEN, hasTouch: true, isMobile: true });

  test("Preview opens the app in a tab of its own", async ({ page }) => {
    await openSession(page);
    await startPreview(page);

    const [tab] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("button", { name: "Preview", exact: true }).click(),
    ]);

    await expect(tab.getByRole("heading", { name: "Side project, running" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Preview", exact: true })).toHaveCount(0);
  });
});
