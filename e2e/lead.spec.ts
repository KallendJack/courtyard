import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// A code workspace's Lead (#347; Paper, "2 · Agreed", Code workspace row: Lead not started, Lead
// running, the Lead's chat, Lead resting), on start-worker.mjs's Toolshed: three ready issues on
// the fake GitHub, in a build order. Tests here run in order, on one Lead.

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

const HOME = "/workspaces/toolshed";

test.beforeEach(async ({ request }) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
});

test.afterAll(async ({ request }) => {
  await request.post("/api/github/sign-out", { data: {} });
});

test("Run the build order starts the Lead, which starts two builders and keeps the third next", async ({
  page,
}) => {
  await page.goto(HOME);
  const nextUp = page.getByRole("region", { name: "Next up" });
  const first = nextUp.getByRole("region", { name: "Build #31" });
  await expect(first).toContainText("Hooks on the pegboard");
  await shot(page, "lead-not-started");

  await first.getByRole("button", { name: "Run the build order" }).click();
  await expect(first).toContainText("The Lead runs the build order");
  await shot(page, "lead-confirm");
  await first.getByRole("button", { name: "Start the order" }).click();

  const running = page.getByRole("region", { name: "Running" });
  await expect(running).toContainText("Lead");
  await expect(running.getByRole("listitem")).toHaveCount(3);
  await shot(page, "lead-running");
});

test("the Lead's chat shows what it builds, what's next and what's ready to merge", async ({
  page,
}) => {
  await page.goto(HOME);
  const running = page.getByRole("region", { name: "Running" });
  await running.getByRole("link", { name: /Lead/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lead");
  await expect(page.getByText("Started building Hooks on the pegboard")).toBeVisible();
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  const strip = page.getByRole("region", { name: "Build order" });
  await expect(strip).toContainText("Building · 2");
  await expect(strip).toContainText("Hooks on the pegboard");
  await expect(strip).toContainText("Labels on the drawers");
  await expect(strip).toContainText("A light over the bench");
  await expect(strip).toContainText("To merge");
  await shot(page, "lead-chat");
});

test("told to pause, the Lead's builders carry on and nothing new starts; Run wakes it", async ({
  page,
}) => {
  await page.goto(HOME);
  const running = page.getByRole("region", { name: "Running" });
  await running.getByRole("link", { name: /Lead/ }).first().click();
  // The chat drawn first, so the box typed in is the one that stays.
  await expect(page.getByRole("region", { name: "Build order" })).toContainText("Building · 2");
  await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("pause");
  await expect(box).toHaveValue("pause");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Paused", { exact: false }).first()).toBeVisible();

  await page.goto(HOME);
  const lead = running.getByRole("listitem").first();
  await expect(lead).toContainText("Paused");
  await expect(lead).toContainText("Builders carry on · nothing new starts");
  await shot(page, "lead-paused");

  await lead.getByRole("button", { name: "Run" }).click();
  await expect(lead).toContainText("Running the build order");
  await expect(lead.getByRole("button", { name: "Pause" })).toBeVisible();
});
