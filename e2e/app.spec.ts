import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { LONG_SESSION_ID, LONG_SESSION_TURNS } from "./long-session.ts";
import { fromTheEnd, pageScroll, pageScrollsSideways, scrollPageTo } from "./page-scroll.ts";

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
  background_color: z.string(),
  theme_color: z.string(),
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

/** On the cover screen's frame, a phone's or a narrow window's (#197), the box opens with Type. */
const typeIn = (page: Page) => page.getByRole("button", { name: "Type" }).click();

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
    await typeIn(page);
    const form = page.getByLabel("Message", { exact: true }).locator("xpath=ancestor::form");

    const box = await boxOf(form);
    expect(box.height).toBeLessThan(COVER_SCREEN.height * 0.25);
  });

  test("keeps the message box in view with the keyboard open", async ({ page }) => {
    await page.goto(LONG_SESSION);
    await typeIn(page);
    // The page shrinks to what's left above the keyboard (interactive-widget=resizes-content).
    await page.setViewportSize({ width: COVER_SCREEN.width, height: 300 });

    await expect(page.getByLabel("Message", { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Send" })).toBeInViewport({ ratio: 1 });
  });

  test("never pushes the page sideways with a long word", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await typeIn(page);
    await page
      .getByLabel("Message", { exact: true })
      .fill(`https://example.com/${"a".repeat(300)}`);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText("You said:");
    // Sent, the box closes into the frame (#197); the strip says when the answer has come.
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toContainText(
      "Tap or hold to talk",
    );

    expect(await pageScrollsSideways(page)).toBe(false);
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

    test("only the page scrolls, on its panel, and the workspaces stay put (#266)", async ({
      page,
    }) => {
      await page.goto(LONG_SESSION);
      const session = page.getByRole("list", { name: "Session" });
      await expect(session).toContainText(`You said: Message ${LONG_SESSION_TURNS}`);
      const workspaces = await boxOf(page.getByRole("navigation", { name: "Workspaces" }));

      await scrollPageTo(page, 0);
      await expect(session.getByText("You said: Message 1", { exact: true })).toBeVisible();
      expect(await pageScroll(page)).toMatchObject({ document: false, windowScrollY: 0 });
      expect(await boxOf(page.getByRole("navigation", { name: "Workspaces" }))).toEqual(workspaces);
    });
  });
}

test("draws only the turns near the screen in a long session", async ({ page }) => {
  await page.goto(LONG_SESSION);
  const session = page.getByRole("list", { name: "Session" });

  await expect(session).toContainText(`You said: Message ${LONG_SESSION_TURNS}`);
  const drawn = await session.locator(":scope > li").count();
  expect(drawn).toBeLessThan(40);

  await scrollPageTo(page, 0);
  await expect(session.getByText("You said: Message 1", { exact: true })).toBeVisible();
});

test.describe("at the end of a long session", () => {
  test.use({ viewport: COVER_SCREEN });

  test("keeps the end in view while an answer streams in", async ({ page }) => {
    await page.goto(LONG_SESSION);
    // An answer many lines long, so it grows well past the bottom of the screen as it streams.
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    await typeIn(page);
    await page.getByLabel("Message", { exact: true }).fill(lines);
    await page.getByRole("button", { name: "Send" }).click();
    // Sent, the box closes into the frame (#197); the strip says when the answer has come.
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toContainText(
      "Tap or hold to talk",
    );

    // It follows once a frame, so the last of the answer can take a frame or two to come into view.
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);
  });

  // Reading back while it answers, and Jump to latest, are in chat-flow.spec.ts (#168).

  test("scrolls a failed turn's reason into view", async ({ page }) => {
    await page.goto(LONG_SESSION);
    await typeIn(page);
    await page.getByLabel("Message", { exact: true }).fill("please fail");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByRole("button", { name: "Retry" })).toBeInViewport();
  });
});

test("is installable, and caches the app but never session data", async ({ page, request }) => {
  const manifest = Manifest.parse(await (await request.get("/manifest.webmanifest")).json());
  expect(manifest).toMatchObject({ name: "Courtyard", display: "standalone", start_url: "/" });
  // An installed app on Android paints the strip behind the gesture bar from these colours, so
  // both are the theme's ground (#157), as the page's own theme-color is (#210).
  expect(manifest.background_color.toLowerCase()).toBe("#070707");
  expect(manifest.theme_color.toLowerCase()).toBe("#070707");
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

test("keeps every file the app is made of once installed, but Mermaid's only once a diagram needs them", async ({
  page,
}) => {
  await installed(page);
  const keptOnInstall = await keptByTheApp(page);

  // A diagram, drawn: the scripts it asks for, Mermaid's among them.
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/assets/") && path.endsWith(".js")) asked.push(path);
  });
  await page.goto("/workspaces/garage-gym");
  await page
    .getByLabel("Message", { exact: true })
    .fill("A diagram:\n\n```mermaid\nflowchart TD\n  a[Measure] --> b[Keep riding]\n```");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(
    page.getByRole("figure", { name: "Diagram", exact: true }).locator("svg"),
  ).toBeVisible();
  const mermaids = asked.filter((path) => /mermaid|flowDiagram|dagre/i.test(path));
  expect(mermaids.length).toBeGreaterThan(0);

  // Mermaid's (over a megabyte) weren't kept on install, so a new build doesn't download them on
  // a phone's data; every other file was, so pages not yet opened work offline. Mermaid's own
  // files are named by its build: `<name>-<ID>-<hash>.js`, the ID eight capitals and digits.
  expect(keptOnInstall.filter((path) => mermaids.includes(path))).toEqual([]);
  const built = readdirSync(join(import.meta.dirname, "../apps/web/dist/assets"));
  const others = built
    .filter((file) => !/-[A-Z0-9]{8}-/.test(file))
    .map((file) => `/assets/${file}`)
    .filter((path) => !mermaids.includes(path) && !/no-elk/.test(path));
  expect(others.length).toBeGreaterThan(20);
  expect(keptOnInstall).toEqual(expect.arrayContaining(others));
  // Once a diagram has needed them, they're kept like the rest.
  await expect.poll(() => keptByTheApp(page)).toEqual(expect.arrayContaining(mermaids));
});

test("opens offline and says the worker can't be reached", async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  await page.goto(LONG_SESSION);

  // The app itself opens, and says the worker can't be reached, rather than a browser error.
  await expect(page.getByRole("heading", { name: "Worker offline" })).toBeVisible();
});

test("the home page shows straight away, and offers the update once the worker has asked", async ({
  page,
}) => {
  // The live status held back, as if the worker were still asking GitHub whether main moved on.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/live", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/");
  const updates = page.getByRole("region", { name: "Updates" });

  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Garage gym" }).first()).toBeVisible();
  await expect(updates).toHaveCount(0);

  release();
  await expect(updates).toContainText("A new version is ready");
});

test("the owner updates the live app from the app, and sees how it went", async ({ page }) => {
  await page.goto("/");
  const updates = page.getByRole("region", { name: "Updates" });

  await expect(updates).toContainText("A new version is ready");
  await expect(updates).toContainText("A newer version");
  await updates.getByRole("button", { name: "Update" }).click();

  await expect(updates).toContainText("Updating");
  await expect(updates).toContainText("Updated to", { timeout: 15_000 });
  await expect(updates.getByRole("button", { name: "Reload" })).toBeVisible();
});
