import { expect, type Page, test } from "@playwright/test";
import { LONG_SESSION_ID, LONG_SESSION_TURNS } from "./long-session.ts";

/** The Galaxy Z Fold 8's screens, and a desktop, in CSS pixels. */
const COVER_SCREEN = { width: 400, height: 640 }; // 10:16, folded
const UNFOLDED = { width: 950, height: 712 }; // 4:3, landscape
const DESKTOP = { width: 1440, height: 900 };

const boxOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
};

test.describe("on the cover screen", () => {
  test.use({ viewport: COVER_SCREEN });

  test("is one column: workspaces across the top, the page below", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    const workspaces = page.getByRole("navigation", { name: "Workspaces" });
    const main = page.getByRole("main");

    const nav = await boxOf(workspaces);
    const content = await boxOf(main);
    expect(nav.y + nav.height).toBeLessThanOrEqual(content.y + 1);
    expect(content.width).toBeGreaterThan(COVER_SCREEN.width * 0.85);
  });

  test("keeps the message box compact, leaving room for the keyboard", async ({ page }) => {
    await page.goto(`/workspaces/garage-gym/sessions/${LONG_SESSION_ID}`);
    const form = page.getByLabel("Message").locator("xpath=ancestor::form");

    const box = await boxOf(form);
    expect(box.height).toBeLessThan(COVER_SCREEN.height * 0.25);
  });
});

for (const [name, viewport] of [
  ["unfolded", UNFOLDED],
  ["on a desktop", DESKTOP],
] as const) {
  test.describe(name, () => {
    test.use({ viewport });

    test("is two panes: workspaces beside the page", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      const workspaces = page.getByRole("navigation", { name: "Workspaces" });

      const nav = await boxOf(workspaces);
      const content = await boxOf(page.getByRole("main"));
      expect(nav.x + nav.width).toBeLessThanOrEqual(content.x + 1);
      expect(nav.height).toBeGreaterThan(viewport.height * 0.5);
    });
  });
}

test("draws only the turns near the screen in a long session", async ({ page }) => {
  await page.goto(`/workspaces/garage-gym/sessions/${LONG_SESSION_ID}`);
  const session = page.getByRole("list", { name: "Session" });

  await expect(session).toContainText(`You said: Message ${LONG_SESSION_TURNS}`);
  const drawn = await session.locator(":scope > li").count();
  expect(drawn).toBeLessThan(40);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(session.getByText("You said: Message 1", { exact: true })).toBeVisible();
});

test("is installable, and caches the app but never session data", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Courtyard", display: "standalone", start_url: "/" });
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }

  await page.goto("/");
  const state = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.state,
  );
  expect(state).toBe("activated");
  await page.reload();
  await page.goto(`/workspaces/garage-gym/sessions/${LONG_SESSION_ID}`);
  await expect(page.getByRole("list", { name: "Session" })).toContainText("Message");

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const entry of await (await caches.open(name)).keys()) urls.push(entry.url);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((url) => url.includes("/api/"))).toEqual([]);
});
