import { err, ok, type Result } from "../../lib/result.ts";

/**
 * Takes a screenshot of a page of an app serving on the worker machine's localhost (#183): at
 * `path`, in a window `viewport` big, sent the owner's `cookies` for it, so it shows what they see.
 * The PNG's bytes, or why it couldn't.
 */
export type Screenshot = (shot: {
  app: number;
  path: string;
  viewport: { readonly width: number; readonly height: number };
  cookies: string | undefined;
}) => Promise<Result<Uint8Array, string>>;

/** How long a page has to load before the screenshot gives up. */
const LOAD_MS = 30_000;
/** How long it waits after loading for the page's own requests to settle, at most. */
const SETTLE_MS = 5_000;

/**
 * With the Chromium already on the machine for the browser tests (Playwright's), headless, a
 * fresh browser for each screenshot so none keeps anything between them.
 */
export const takeScreenshot: Screenshot = async (shot) => {
  // Loaded only when a screenshot is taken, so the worker starts without it.
  const { chromium } = await import("playwright-core");
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    return err(
      "Chromium isn't installed on the worker machine: run pnpm exec playwright install chromium there.",
    );
  }
  try {
    const context = await browser.newContext({
      viewport: shot.viewport,
      ...(shot.cookies === undefined ? {} : { extraHTTPHeaders: { cookie: shot.cookies } }),
    });
    const page = await context.newPage();
    const answer = await page.goto(`http://localhost:${shot.app}${shot.path}`, {
      waitUntil: "load",
      timeout: LOAD_MS,
    });
    if (answer === null) return err("the page didn't load.");
    await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => undefined);
    return ok(await page.screenshot({ type: "png" }));
  } catch (error) {
    return err(
      error instanceof Error ? (error.message.split("\n")[0] ?? "it failed.") : "it failed.",
    );
  } finally {
    await browser.close();
  }
};
