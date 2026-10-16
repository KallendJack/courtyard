import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// A code session's tasks (#182), in the Side project code workspace start-worker.mjs sets up. The
// fake starts one with "start task: <command>": its repository's scripts/serve.mjs runs until it's
// stopped.

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

test("a running task shows above the Reply box with its last line, opens on its output, and Stop ends it in a line where it ended", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/workspaces/side-project/sessions", {
    data: {
      text: "start task: node scripts/serve.mjs (for: Serve the app)",
      model: { provider: "fake", model: "echo" },
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await page.goto(`/workspaces/side-project/sessions/${id}`);

  const running = page.getByRole("list", { name: "Tasks running" });
  const row = running.getByRole("button", { name: /^Task · node scripts\/serve\.mjs/ });
  // Its turn has ended; the task runs on, above the Reply box, with the last line it printed.
  await expect(page.getByText(/Your turn · finished/)).toBeVisible();
  await expect(row).toContainText("Listening on 5173");
  await expect(row).toContainText(/\d+:\d\d/);
  const box = await row.boundingBox();
  const reply = await page.getByRole("textbox").boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(reply?.y ?? 0);
  await shot(page, "task-running");

  await row.click();
  const sheet = page.getByRole("dialog", { name: "node scripts/serve.mjs" });
  await expect(sheet).toContainText("Listening on 5173");
  await shot(page, "task-output");
  await sheet.getByRole("button", { name: "Stop" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();

  // Ended, it's a line in the conversation where it ended, and the row above the box goes.
  await expect(running).toHaveCount(0);
  const ended = page.getByRole("button", {
    name: /^Task · node scripts\/serve\.mjs · .*stopped by you$/,
  });
  await expect(ended).toBeVisible();
  await ended.click();
  await expect(page.getByRole("dialog", { name: "node scripts/serve.mjs" })).toContainText(
    "Listening on 5173",
  );
  await expect(
    page
      .getByRole("dialog", { name: "node scripts/serve.mjs" })
      .getByRole("button", { name: "Stop" }),
  ).toHaveCount(0);
});
