import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  buzzes,
  goOutOfSight,
  hear,
  hearAnew,
  listenedIn,
  micOn,
  pause,
  refuse,
  standInSpeechRecognition,
  vibrations,
  withoutSpeechRecognition,
} from "./speech-recognition.ts";

/** Words enough that the fake model takes a few seconds to write them. */
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");

// Talking to Courtyard from the Handheld frame's talk strip (#79, Paper board Handheld · 02): tap
// to listen hands-free and tap to stop, or hold and let go, in the browser's own speech
// recognition. The words go into the message box as they're heard, and the owner sends them
// (#198). Playwright has no microphone, so the test speaks through a stand-in.

/** The Galaxy Z Fold 8's screens, in CSS pixels: unfolded and folded. */
const SCREENS = {
  unfolded: { width: 950, height: 712 },
  "the cover screen": { width: 400, height: 900 },
};

test.use({ hasTouch: true, isMobile: true });

/**
 * The talk strip, by its name, which stays the same whatever it says, showing `says`: what it is
 * doing, and the words heard.
 */
const strip = (page: Page, says: RegExp) =>
  page.getByRole("button", { name: "Talk", exact: true }).filter({ hasText: says });
const session = (page: Page) => page.getByRole("list", { name: "Session" });
const message = (page: Page) => page.getByRole("textbox", { name: "Message" });

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

    test("a tap listens hands-free and puts the words in the message box as they're heard, after anything typed; a second tap stops, and nothing is sent until Send", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await page.getByRole("button", { name: "Type" }).click();
      await message(page).fill("About the bench:");
      await expect(strip(page, /Tap or hold to talk/)).toHaveAttribute("aria-pressed", "false");
      await strip(page, /Tap or hold to talk/).click();

      // Pressed while it listens; what's heard is its description, not its name.
      const listening = strip(page, /Listening · tap to stop/);
      await expect(listening).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      expect(await listenedIn(page)).toBe("en-GB");
      expect(await buzzes(page)).toBeGreaterThan(0);

      await hear(page, "Could the bench");
      await expect(message(page)).toHaveValue("About the bench: Could the bench");
      await hear(page, "Could the bench go sideways instead?");
      await expect(message(page)).toHaveValue(
        "About the bench: Could the bench go sideways instead?",
      );
      await expect(listening).toHaveAccessibleDescription(/Could the bench go sideways instead\?/);

      await listening.click();
      // Stopped: the same double tick as letting go of a hold.
      expect(await vibrations(page)).toContainEqual([12, 70, 12]);
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Type" })).toBeVisible();
      await expect.poll(() => micOn(page)).toBe(false);
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
      await expect(message(page)).toHaveValue(
        "About the bench: Could the bench go sideways instead?",
      );

      await page.getByRole("button", { name: "Start" }).click();
      await expect(session(page)).toContainText(
        "You said: About the bench: Could the bench go sideways instead?",
      );
    });

    test("words heard as Chrome on Android hears them, the whole phrase again each time, go in once", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await expect(message(page)).toBeVisible();
      const said = ["hi", "hi I", "hi I just", "hi I just want", "hi I just want to"];
      for (const [at, words] of said.entries()) await hearAnew(page, words, at % 2 === 0);
      await hearAnew(page, "Hi I just want to check", true);
      await expect(strip(page, /Listening/)).toHaveAccessibleDescription(
        /“Hi I just want to check”$/,
      );

      await strip(page, /Listening · tap to stop/).click();
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await expect.poll(() => micOn(page)).toBe(false);
      await expect(message(page)).toHaveValue("Hi I just want to check");
    });

    test("Send while it listens sends what's in the box and stops listening", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "Pegs on the wall");
      await expect(message(page)).toHaveValue("Pegs on the wall");

      await page.getByRole("button", { name: "Start" }).click();
      await expect(session(page)).toContainText("You said: Pegs on the wall");
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await expect.poll(() => micOn(page)).toBe(false);
    });

    test("Cancel stops listening and drops what it heard, keeping what was typed", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await page.getByRole("button", { name: "Type" }).click();
      await message(page).fill("Keep this");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "Never mind the rack");
      await expect(message(page)).toHaveValue("Keep this Never mind the rack");

      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await expect(message(page)).toHaveValue("Keep this");
      await hear(page, "still talking");
      await page.waitForTimeout(500);
      await expect(message(page)).toHaveValue("Keep this");
      await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
    });

    test("held, it's push to talk: letting go stops listening, and sliding onto Cancel drops it", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      const talk = await centre(strip(page, /Tap or hold to talk/));
      await page.mouse.move(talk.x, talk.y);
      await page.mouse.down();
      await expect(strip(page, /Let go to stop/)).toContainText("Slide onto Cancel to drop it");
      await hear(page, "Pegs for the bands");
      await expect(message(page)).toHaveValue("Pegs for the bands");
      await page.mouse.up();
      expect(await vibrations(page)).toContainEqual([12, 70, 12]);
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await page.waitForTimeout(500);
      await expect(message(page)).toHaveValue("Pegs for the bands");
      await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);

      await page.mouse.move(talk.x, talk.y);
      await page.mouse.down();
      await expect(strip(page, /Let go to stop/)).toBeVisible();
      await hear(page, "Something I'll regret");
      await expect(message(page)).toHaveValue("Pegs for the bands Something I'll regret");
      const cancel = await centre(page.getByRole("button", { name: "Cancel", exact: true }));
      await page.mouse.move(cancel.x, cancel.y, { steps: 5 });
      await expect(strip(page, /Let go to drop it/)).toContainText("Slide back to keep it");
      await page.mouse.up();
      await expect(strip(page, /Tap or hold to talk/)).toBeVisible();
      await page.waitForTimeout(500);
      await expect(message(page)).toHaveValue("Pegs for the bands");
    });

    test("while it answers, what's said and sent is queued until the turn ends", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await page.getByRole("button", { name: "Type" }).click();
      await message(page).fill(words(150));
      await page.getByRole("button", { name: "Start" }).click();

      const answering = strip(page, /Answering · talk to add/);
      await expect(answering).toContainText("What you say now queues");
      await answering.click();
      await hear(page, "Also the cover screen");
      await strip(page, /Listening · tap to stop/).click();
      await page.getByRole("button", { name: "Send" }).click();

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
      await expect(strip(page, /Listening · tap to stop/)).toContainText("The rack");
      await hear(page, "by the window");
      await expect(strip(page, /Listening · tap to stop/)).toContainText("The rack by the window");
      await expect(message(page)).toHaveValue("The rack by the window");

      await strip(page, /Listening · tap to stop/).click();
      await expect.poll(() => micOn(page)).toBe(false);
      await expect(message(page)).toHaveValue("The rack by the window");
    });

    test("tapped to stop with nothing heard, it says so", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await strip(page, /Listening · tap to stop/).click();
      await expect(strip(page, /Tap or hold to talk/)).toContainText("Nothing heard");
    });

    test("hands-free, it stops listening once nothing new is heard for a while, and what was heard waits in the message box", async ({
      page,
    }) => {
      await page.clock.install();
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "The bench");
      await expect(strip(page, /Listening · tap to stop/)).toContainText("The bench");
      // Chrome on Android stops on its own in a pause, and is started again.
      await page.clock.fastForward(8_000);
      await pause(page);
      await expect.poll(() => micOn(page)).toBe(true);

      await page.clock.fastForward(20_000);
      await expect(strip(page, /Tap or hold to talk/)).toContainText("Nothing heard for a while");
      await expect(message(page)).toHaveValue("The bench");
      expect(await micOn(page)).toBe(false);
    });

    test("it stops listening when Courtyard goes out of sight, and what was heard waits in the message box", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await strip(page, /Tap or hold to talk/).click();
      await hear(page, "Pegs for");
      await expect(strip(page, /Listening · tap to stop/)).toContainText("Pegs for");

      await goOutOfSight(page);
      await expect(strip(page, /Tap or hold to talk/)).toContainText("out of sight");
      await expect(message(page)).toHaveValue("Pegs for");
      await page.waitForTimeout(500);
      expect(await micOn(page)).toBe(false);
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
      // Said out loud too, for a screen reader.
      await expect(
        page.getByRole("status").filter({ hasText: "The microphone isn't allowed" }),
      ).toHaveCount(1);
      await expect(message(page)).toHaveValue("Half of a");
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
    await expect(message(page)).toBeFocused();
  });

  test("nothing vibrates when the phone asks for less motion", async ({ page }) => {
    await standInSpeechRecognition(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workspaces/garage-gym");
    await strip(page, /Tap or hold to talk/).click();
    await hear(page, "Quietly");
    await strip(page, /Listening · tap to stop/).click();
    await expect(message(page)).toHaveValue("Quietly");
    expect(await buzzes(page)).toBe(0);
  });
});
