import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  buzzes,
  hear,
  listenedIn,
  pause,
  refuse,
  standInSpeechRecognition,
  withoutSpeechRecognition,
} from "./speech-recognition.ts";

/** Words enough that the fake model takes a few seconds to write them. */
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");

// Talking to Courtyard from the Handheld frame's talk strip (#79, Paper board Handheld · 02): tap
// to listen hands-free and tap to send, or hold and let go, in the browser's own speech
// recognition. Playwright has no microphone, so the test speaks through a stand-in.

/** The Galaxy Z Fold 8's screens, in CSS pixels: unfolded and folded. */
const SCREENS = {
  unfolded: { width: 950, height: 712 },
  "the cover screen": { width: 400, height: 900 },
};

test.use({ hasTouch: true, isMobile: true });

const strip = (page: Page, name: RegExp) => page.getByRole("button", { name });
const session = (page: Page) => page.getByRole("list", { name: "Session" });

/** Where a finger goes to press something. */
const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

for (const [screen, viewport] of Object.entries(SCREENS)) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport });
    test.beforeEach(async ({ page }) => {
      await standInSpeechRecognition(page);
    });

    test("a tap listens hands-free, shows the words as they're heard, and a second tap sends them", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();

      const listening = strip(page, /Listening · tap to send/);
      await expect(listening).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      expect(await listenedIn(page)).toBe("en-GB");
      expect(await buzzes(page)).toBeGreaterThan(0);

      await hear(page, "Could the bench");
      await expect(listening).toContainText("Could the bench");
      await hear(page, "Could the bench go sideways instead?");
      await expect(listening).toContainText("Could the bench go sideways instead?");

      await listening.click();
      await expect(session(page)).toContainText("You said: Could the bench go sideways instead?");
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Type" })).toBeVisible();
    });

    test("Cancel drops what was said", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "Never mind the rack");
      await expect(strip(page, /Listening/)).toContainText("Never mind the rack");

      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await hear(page, "still talking");
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
    });

    test("held, it's push to talk: letting go sends, and sliding onto Cancel drops it", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      const talk = await centre(strip(page, /Tap or hold to talk/));
      await page.mouse.move(talk.x, talk.y);
      await page.mouse.down();
      await expect(strip(page, /Let go to send/)).toContainText("Slide onto Cancel to drop it");
      await hear(page, "Pegs for the bands");
      await page.mouse.up();
      await expect(session(page)).toContainText("You said: Pegs for the bands");
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();

      await page.mouse.move(talk.x, talk.y);
      await page.mouse.down();
      await expect(strip(page, /Let go to send/)).toBeVisible();
      await hear(page, "Something I'll regret");
      const cancel = await centre(page.getByRole("button", { name: "Cancel", exact: true }));
      await page.mouse.move(cancel.x, cancel.y, { steps: 5 });
      await expect(strip(page, /Let go to drop it/)).toBeVisible();
      await page.mouse.up();
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await page.waitForTimeout(500);
      await expect(session(page)).not.toContainText("Something I'll regret");
    });

    test("while it answers, what's said is queued until the turn ends", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await page.getByRole("button", { name: "Type" }).click();
      await page.getByRole("textbox", { name: "Message" }).fill(words(150));
      await page.getByRole("button", { name: "Start" }).click();

      const answering = strip(page, /Answering · talk to add/);
      await expect(answering).toContainText("What you say now queues");
      await answering.click();
      await hear(page, "Also the cover screen");
      await strip(page, /Listening · tap to send/).click();

      await expect(page.getByRole("list", { name: "Queued messages" })).toContainText(
        "Also the cover screen",
      );
    });

    test("it keeps listening through a pause, when the browser stops on its own", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "The rack");
      await pause(page);
      await expect(strip(page, /Listening · tap to send/)).toContainText("The rack");
      await hear(page, "by the window");
      await expect(strip(page, /Listening · tap to send/)).toContainText("The rack by the window");

      await strip(page, /Listening · tap to send/).click();
      await expect(session(page)).toContainText("You said: The rack by the window");
    });

    test("when the microphone isn't allowed, it says so, and what was heard waits in the message box", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "Half of a");
      await refuse(page);

      await expect(strip(page, /Tap or hold to talk/)).toContainText(
        "The microphone isn't allowed",
      );
      await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Half of a");
    });
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: SCREENS["the cover screen"] });

  test("where the browser can't listen, the talk strip opens the keyboard, as Type does", async ({
    page,
  }) => {
    await withoutSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    await strip(page, /Tap or hold to talk/).click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
  });

  test("nothing vibrates when the phone asks for less motion", async ({ page }) => {
    await standInSpeechRecognition(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workspaces/garage-gym");
    await strip(page, /Tap or hold to talk/).click();
    await hear(page, "Quietly");
    await strip(page, /Listening · tap to send/).click();
    await expect(session(page)).toContainText("You said: Quietly");
    expect(await buzzes(page)).toBe(0);
  });
});
