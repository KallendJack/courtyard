import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { LONG_SESSION_ID, LONG_SESSION_TURNS } from "./long-session.ts";

/** The Galaxy Z Fold 8's screens, and a desktop, in CSS pixels. */
const COVER_SCREEN = { width: 400, height: 640 }; // 10:16, folded
const UNFOLDED = { width: 950, height: 712 }; // 4:3, landscape
const DESKTOP = { width: 1440, height: 900 };

const LONG_SESSION = `/workspaces/garage-gym/sessions/${LONG_SESSION_ID}`;

/** The parts of the web app manifest that make Courtyard installable. */
const Manifest = z.object({
  name: z.string(),
  display: z.string(),
  start_url: z.string(),
  icons: z.array(z.object({ src: z.string(), sizes: z.string() })),
});

/** Every URL the app's service worker has kept, across all its caches. */
const keptByTheApp = (page: Page) =>
  page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const entry of await (await caches.open(name)).keys())
        urls.push(new URL(entry.url).pathname);
    }
    return urls;
  });

/** Waits until the app is installed: its service worker has taken over. */
const installed = async (page: Page) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe("activated");
};

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
    await page.goto(LONG_SESSION);
    const form = page.getByLabel("Message").locator("xpath=ancestor::form");

    const box = await boxOf(form);
    expect(box.height).toBeLessThan(COVER_SCREEN.height * 0.25);
  });

  test("keeps the message box in view with the keyboard open", async ({ page }) => {
    await page.goto(LONG_SESSION);
    await page.getByLabel("Message").focus();
    // The page shrinks to what's left above the keyboard (interactive-widget=resizes-content).
    await page.setViewportSize({ width: COVER_SCREEN.width, height: 300 });

    await expect(page.getByLabel("Message")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Send" })).toBeInViewport({ ratio: 1 });
  });

  test("never pushes the page sideways with a long word", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByLabel("Message").fill(`https://example.com/${"a".repeat(300)}`);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
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
  await page.goto(LONG_SESSION);
  const session = page.getByRole("list", { name: "Session" });

  await expect(session).toContainText(`You said: Message ${LONG_SESSION_TURNS}`);
  const drawn = await session.locator(":scope > li").count();
  expect(drawn).toBeLessThan(40);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(session.getByText("You said: Message 1", { exact: true })).toBeVisible();
});

test.describe("at the end of a long session", () => {
  test.use({ viewport: COVER_SCREEN });

  test("keeps the end in view while an answer streams in", async ({ page }) => {
    await page.goto(LONG_SESSION);
    // An answer many lines long, so it grows well past the bottom of the screen as it streams.
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    await page.getByLabel("Message").fill(lines);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

    const fromTheEnd = await page.evaluate(
      () => document.documentElement.scrollHeight - (window.innerHeight + window.scrollY),
    );
    expect(fromTheEnd).toBeLessThan(2);
  });

  test("scrolls a failed turn's reason into view", async ({ page }) => {
    await page.goto(LONG_SESSION);
    await page.getByLabel("Message").fill("please fail");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByRole("button", { name: "Retry" })).toBeInViewport();
  });
});

test("is installable, and caches the app but never session data", async ({ page, request }) => {
  const manifest = Manifest.parse(await (await request.get("/manifest.webmanifest")).json());
  expect(manifest).toMatchObject({ name: "Courtyard", display: "standalone", start_url: "/" });
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }

  await installed(page);
  await page.goto(LONG_SESSION);
  await expect(page.getByRole("list", { name: "Session" })).toContainText("Message");
  // A file that doesn't exist gets the app's page back from the worker: never kept as the file.
  await page.evaluate(() => fetch("/assets/not-a-real-file.js"));

  const kept = await keptByTheApp(page);
  expect(kept.filter((path) => path.startsWith("/api/"))).toEqual([]);
  expect(kept).not.toContain("/assets/not-a-real-file.js");
});

test("keeps every file the app is made of once installed, not just pages opened", async ({
  page,
}) => {
  await installed(page);

  const built = readdirSync(join(import.meta.dirname, "../apps/web/dist/assets"));
  expect(built.length).toBeGreaterThan(0);
  expect(await keptByTheApp(page)).toEqual(
    expect.arrayContaining(built.map((file) => `/assets/${file}`)),
  );
});

test("opens offline and says the worker can't be reached", async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  await page.goto(LONG_SESSION);

  // The app itself opens, and says the worker can't be reached, rather than a browser error.
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();
});
