import { expect, type Locator, type Page, test } from "@playwright/test";
import { LONG_SESSION_ID } from "./long-session.ts";

// The app draws to the screen's edges (viewport-fit=cover), so the strip behind a phone's
// gesture bar is the page's own colour (#157). What sits at the bottom moves up clear of that bar.

/** How tall the emulated gesture bar is. */
const GESTURE_BAR = 48;

/** Puts a gesture bar of `height` along the bottom of the screen, as a phone's safe-area inset. */
const setGestureBar = async (page: Page, height: number) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: height } });
};

/** Where the bottom edge of `locator` is, in the screen. */
const bottomOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  return (box?.y ?? 0) + (box?.height ?? 0);
};

/** How far `locator` moves up when a gesture bar appears. */
const liftFromGestureBar = async (page: Page, locator: Locator) => {
  await setGestureBar(page, 0);
  const without = await bottomOf(locator);
  await setGestureBar(page, GESTURE_BAR);
  await expect.poll(async () => without - (await bottomOf(locator))).toBeGreaterThan(0);
  return without - (await bottomOf(locator));
};

test.describe("on a phone", () => {
  test.use({ viewport: { width: 400, height: 640 } }); // the Galaxy Z Fold 8's cover screen

  test("the message box moves up clear of the gesture bar", async ({ page }) => {
    // Long enough that the message box sits pinned to the bottom of the screen.
    await page.goto(`/workspaces/garage-gym/sessions/${LONG_SESSION_ID}`);
    await expect(page.getByLabel("Message")).toBeEnabled();

    const attach = page.getByRole("button", { name: "Attach photos or PDFs" });
    expect(await liftFromGestureBar(page, attach)).toBe(GESTURE_BAR);
  });
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the sidebar's Log out moves up clear of the gesture bar", async ({ page }) => {
    await page.goto("/");
    const logOut = page.getByRole("button", { name: "Log out", exact: true });
    expect(await liftFromGestureBar(page, logOut)).toBe(GESTURE_BAR);
  });
});
