import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  buzzes,
  comeBack,
  goOutOfSight,
  hear,
  hearAnew,
  listenedIn,
  loseConnection,
  micOn,
  pause,
  refuse,
  screenKeptAwake,
  standInSpeechRecognition,
  vibrations,
  withoutSpeechRecognition,
} from "./speech-recognition.ts";

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** What talking says where the browser has no speech service to reach (#422). */
const CANT_LISTEN = "This browser can't listen. Chrome or Edge can";

/** Words enough that the fake model takes a few seconds to write them. */
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");

// Talking to Courtyard from the Handheld frame: the cover screen's talk strip (#79, Paper board
// Handheld · 02) and a tablet's Talk key (#206). Tap to listen hands-free and tap to stop, or hold
// and let go, in the browser's own speech recognition. The words go into the message box as
// they're heard, and the owner sends them (#198). Playwright has no microphone, so the test speaks
// through a stand-in.

/**
 * The Galaxy Z Fold 8's screens, in CSS pixels, unfolded and folded, and what talking says on
 * each, in the key's or the strip's words: waiting, listening hands-free, held, and while an
 * answer comes. On the cover screen, the strip shows the words heard too, and has Type and Cancel
 * beside it.
 */
const SCREENS = {
  unfolded: {
    viewport: { width: 950, height: 712 },
    idle: /^Talk/,
    listening: /Tap to stop/,
    held: /Let go to stop/,
    answering: /Answering…/,
    strip: false,
  },
  "the cover screen": {
    viewport: { width: 400, height: 900 },
    idle: /Tap or hold to talk/,
    listening: /Listening · tap to stop/,
    held: /Let go to stop/,
    answering: /Answering · talk to add/,
    strip: true,
  },
};

test.use({ hasTouch: true, isMobile: true });

/**
 * The talk strip or the Talk key, by its name, which stays the same whatever it says, showing
 * `says`: what it is doing, and on the strip the words heard.
 */
const talking = (page: Page, says: RegExp) =>
  page.getByRole("button", { name: "Talk", exact: true }).filter({ hasText: says });
const session = (page: Page) => page.getByRole("list", { name: "Session" });
const message = (page: Page) => page.getByRole("textbox", { name: "Message" });

/** Where a finger goes to press something. */
const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

for (const [screen, says] of Object.entries(SCREENS)) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport: says.viewport });
    test.beforeEach(async ({ page }) => {
      await standInSpeechRecognition(page);
    });

    /** Puts the keyboard in the message box: always there on a tablet; Type opens it on the cover screen. */
    const typeIn = (page: Page) =>
      says.strip ? page.getByRole("button", { name: "Type" }).click() : message(page).click();

    test("a tap listens hands-free and puts the words in the message box as they're heard, after anything typed; a second tap stops, and nothing is sent until Send", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await typeIn(page);
      await message(page).fill("About the bench:");
      await expect(talking(page, says.idle)).toHaveAttribute("aria-pressed", "false");
      await talking(page, says.idle).click();

      // Pressed while it listens; what's heard is its description, not its name.
      const listening = talking(page, says.listening);
      await expect(listening).toHaveAttribute("aria-pressed", "true");
      expect(await listenedIn(page)).toBe("en-GB");
      expect(await buzzes(page)).toBeGreaterThan(0);

      await hear(page, "Could the bench");
      await expect(message(page)).toHaveValue("About the bench: Could the bench");
      await hear(page, "Could the bench go sideways instead?");
      await expect(message(page)).toHaveValue(
        "About the bench: Could the bench go sideways instead?",
      );
      if (says.strip) {
        // Cancel beside the strip, and the box's own ✕, ■ and ↑, as everywhere (#251).
        await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Stop listening" })).toBeVisible();
        await expect(listening).toHaveAccessibleDescription(
          /Could the bench go sideways instead\?/,
        );
      }

      await listening.click();
      // Stopped: the same double tick as letting go of a hold.
      expect(await vibrations(page)).toContainEqual([12, 70, 12]);
      await expect(talking(page, says.idle)).toBeVisible();
      if (says.strip) await expect(page.getByRole("button", { name: "Type" })).toBeVisible();
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
      await talking(page, says.idle).click();
      await expect(message(page)).toBeVisible();
      const said = ["hi", "hi I", "hi I just", "hi I just want", "hi I just want to"];
      for (const [at, words] of said.entries()) await hearAnew(page, words, at % 2 === 0);
      await hearAnew(page, "Hi I just want to check", true);
      await expect(message(page)).toHaveValue("Hi I just want to check");
      if (says.strip) {
        await expect(talking(page, says.listening)).toHaveAccessibleDescription(
          /“Hi I just want to check”$/,
        );
      }

      await talking(page, says.listening).click();
      await expect(talking(page, says.idle)).toBeVisible();
      await expect.poll(() => micOn(page)).toBe(false);
      await expect(message(page)).toHaveValue("Hi I just want to check");
    });

    test("Send while it listens sends what's in the box and stops listening", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await hear(page, "Pegs on the wall");
      await expect(message(page)).toHaveValue("Pegs on the wall");

      await page.getByRole("button", { name: "Start" }).click();
      await expect(session(page)).toContainText("You said: Pegs on the wall");
      await expect(talking(page, says.idle)).toBeVisible();
      await expect.poll(() => micOn(page)).toBe(false);
    });

    test("held, it's push to talk: letting go stops listening, and what was said waits in the box", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      const talk = await centre(talking(page, says.idle));
      await page.mouse.move(talk.x, talk.y);
      await page.mouse.down();
      await expect(talking(page, says.held)).toHaveAttribute("aria-pressed", "true");
      await hear(page, "Pegs for the bands");
      await expect(message(page)).toHaveValue("Pegs for the bands");
      await page.mouse.up();
      expect(await vibrations(page)).toContainEqual([12, 70, 12]);
      await expect(talking(page, says.idle)).toBeVisible();
      await page.waitForTimeout(500);
      await expect(message(page)).toHaveValue("Pegs for the bands");
      await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
    });

    test("while it answers, what's said and sent goes into the answer (#252)", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await typeIn(page);
      // The fake waits for what the owner adds.
      await message(page).fill("wait for more");
      await page.getByRole("button", { name: "Start" }).click();

      const answering = talking(page, says.answering);
      if (says.strip) {
        await expect(answering).toContainText("What you say now goes into this answer");
      }
      await answering.click();
      await hear(page, "Also the cover screen");
      await talking(page, says.listening).click();
      await page.getByRole("button", { name: "Send" }).click();

      const session = page.getByRole("list", { name: "Session" });
      await expect(session).toContainText(/Also the cover screen\s*Added while answering/);
      await expect(session).toContainText("noted: Also the cover screen");
    });

    test("it keeps listening through a pause, when the browser stops on its own", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await hear(page, "The rack");
      await expect(message(page)).toHaveValue("The rack");
      await pause(page);
      await expect(talking(page, says.listening)).toBeVisible();
      await hear(page, "by the window");
      await expect(message(page)).toHaveValue("The rack by the window");
      if (says.strip) {
        await expect(talking(page, says.listening)).toContainText("The rack by the window");
      }

      await talking(page, says.listening).click();
      await expect.poll(() => micOn(page)).toBe(false);
      await expect(message(page)).toHaveValue("The rack by the window");
    });

    test("the screen stays awake while it listens and while an answer comes, and again when Courtyard comes back into sight", async ({
      page,
      request,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await expect(talking(page, says.idle)).toBeEnabled();
      expect(await screenKeptAwake(page)).toBe(false);

      await talking(page, says.idle).click();
      await expect.poll(() => screenKeptAwake(page)).toBe(true);
      await hear(page, "Pegs for the bands");
      await talking(page, says.listening).click();
      await expect.poll(() => screenKeptAwake(page)).toBe(false);
      // The browser settles the last words a moment after the tap; filled before then, they'd
      // replace the long message, and a short answer ends before it's seen kept awake.
      await page.waitForTimeout(500);

      // Long enough to still be coming when it's back in sight, on a slow run too (#371): the fake
      // writes a word every 40 ms. It's stopped once that's been seen.
      await typeIn(page);
      await message(page).fill(words(900));
      await expect(message(page)).toHaveValue(words(900));
      await page.getByRole("button", { name: "Start" }).click();
      await expect(talking(page, says.answering)).toBeVisible();
      await expect.poll(() => screenKeptAwake(page)).toBe(true);
      // Out of sight, the browser lets it sleep; back in sight, it's kept awake again.
      await goOutOfSight(page);
      await expect.poll(() => screenKeptAwake(page)).toBe(false);
      await comeBack(page);
      await expect.poll(() => screenKeptAwake(page)).toBe(true);

      const sessionId = /\/sessions\/([^/?#]+)/.exec(page.url())?.[1];
      await request.post(`/api/sessions/${sessionId}/stop`, { data: { turn: 1 } });
      await expect(talking(page, says.idle)).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => screenKeptAwake(page)).toBe(false);
    });

    test("tapped to stop with nothing heard, it says so", async ({ page }) => {
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await talking(page, says.listening).click();
      await expect(talking(page, says.idle)).toContainText("Nothing heard");
    });

    test("hands-free, it stops listening once nothing new is heard for a while, and what was heard waits in the message box", async ({
      page,
    }) => {
      await page.clock.install();
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await hear(page, "The bench");
      await expect(message(page)).toHaveValue("The bench");
      // Chrome on Android stops on its own in a pause, and is started again.
      await page.clock.fastForward(8_000);
      await pause(page);
      await expect.poll(() => micOn(page)).toBe(true);

      await page.clock.fastForward(20_000);
      await expect(talking(page, says.idle)).toContainText("Nothing heard for a while");
      await expect(message(page)).toHaveValue("The bench");
      expect(await micOn(page)).toBe(false);
    });

    test("it stops listening when Courtyard goes out of sight, and what was heard waits in the message box", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await hear(page, "Pegs for");
      await expect(message(page)).toHaveValue("Pegs for");

      await goOutOfSight(page);
      await expect(talking(page, says.idle)).toContainText("out of sight");
      await expect(message(page)).toHaveValue("Pegs for");
      await page.waitForTimeout(500);
      expect(await micOn(page)).toBe(false);
    });

    test("when the microphone isn't allowed, it says so, and what was heard waits in the message box", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await hear(page, "Half of a");
      await refuse(page);

      await expect(talking(page, says.idle)).toContainText("The microphone isn't allowed");
      // Said out loud too, for a screen reader.
      await expect(
        page.getByRole("status").filter({ hasText: "The microphone isn't allowed" }),
      ).toHaveCount(1);
      await expect(message(page)).toHaveValue("Half of a");
    });

    // #422: Vivaldi, Brave and Opera have the recogniser but no speech service to reach.
    test("when the browser can't reach its speech service before anything is heard, it says this browser can't listen; after words, that it needs a connection", async ({
      page,
    }) => {
      await page.goto("/workspaces/garage-gym");
      await talking(page, says.idle).click();
      await loseConnection(page);
      await expect(talking(page, says.idle)).toContainText(CANT_LISTEN);
      await expect(talking(page, says.idle)).not.toContainText("needs a connection");

      // A real drop, once words were heard: the connection, and the words wait in the box.
      await talking(page, says.idle).click();
      await hear(page, "Chalk for the");
      await expect(message(page)).toHaveValue("Chalk for the");
      await loseConnection(page);
      await expect(talking(page, says.idle)).toContainText("Speech recognition needs a connection");
      await expect(message(page)).toHaveValue("Chalk for the");
    });
  });
}

test.describe("the cover screen's strip, with Type and Cancel beside it", () => {
  test.use({ viewport: SCREENS["the cover screen"].viewport });

  test.beforeEach(async ({ page }) => {
    await standInSpeechRecognition(page);
  });

  test("Cancel stops listening and drops what it heard, keeping what was typed", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Type" }).click();
    await message(page).fill("Keep this");
    await talking(page, /Tap or hold to talk/).click();
    await hear(page, "Never mind the rack");
    await expect(message(page)).toHaveValue("Keep this Never mind the rack");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(talking(page, /Tap or hold to talk/)).toBeVisible();
    await expect(message(page)).toHaveValue("Keep this");
    await hear(page, "still talking");
    await page.waitForTimeout(500);
    await expect(message(page)).toHaveValue("Keep this");
    await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
  });

  test("held, sliding onto Cancel drops what was said", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    const talk = await centre(talking(page, /Tap or hold to talk/));
    await page.mouse.move(talk.x, talk.y);
    await page.mouse.down();
    await expect(talking(page, /Let go to stop/)).toContainText("Slide onto Cancel to drop it");
    await hear(page, "Something I'll regret");
    await expect(message(page)).toHaveValue("Something I'll regret");
    const cancel = await centre(page.getByRole("button", { name: "Cancel", exact: true }));
    await page.mouse.move(cancel.x, cancel.y, { steps: 5 });
    await expect(talking(page, /Let go to drop it/)).toContainText("Slide back to keep it");
    await page.mouse.up();
    await expect(talking(page, /Tap or hold to talk/)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(message(page)).toHaveValue("");
  });

  test("where the browser can't listen, the talk strip opens the keyboard, as Type does", async ({
    page,
  }) => {
    await withoutSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    await talking(page, /Tap or hold to talk/).click();
    await expect(message(page)).toBeFocused();
  });

  test("nothing vibrates when the phone asks for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/workspaces/garage-gym");
    await talking(page, /Tap or hold to talk/).click();
    await hear(page, "Quietly");
    await talking(page, /Listening · tap to stop/).click();
    await expect(message(page)).toHaveValue("Quietly");
    expect(await buzzes(page)).toBe(0);
  });
});

test.describe("the tablet's Talk key", () => {
  test.use({ viewport: SCREENS.unfolded.viewport });

  test("the Talk key lights up while it listens, quietens while an answer comes, and Escape drops what it heard", async ({
    page,
  }) => {
    await standInSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    const key = page.getByRole("button", { name: "Talk", exact: true });
    await expect(key).toHaveText("TalkHold to speak");
    await expect(key).toHaveAccessibleDescription("Talk Hold to speak");

    await key.click();
    await expect(key).toHaveText("ListeningTap to stop");
    await hear(page, "Never mind");
    await expect(message(page)).toHaveValue("Never mind");
    await key.press("Escape");
    await expect(key).toHaveText("TalkHold to speak");
    await expect(message(page)).toHaveValue("");

    await message(page).fill(words(150));
    await page.getByRole("button", { name: "Start" }).click();
    await expect(key).toHaveText("TalkAnswering…");
  });

  test("while it listens, the Reply box shows the words with ✕ to throw them away, ■ to stop and keep them, and ↑ to send", async ({
    page,
  }) => {
    await standInSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    const key = page.getByRole("button", { name: "Talk", exact: true });
    const box = page.locator("form", { has: message(page) });
    const away = box.getByRole("button", { name: "Throw away what you said" });
    const keep = box.getByRole("button", { name: "Stop listening" });
    await expect(away).toHaveCount(0);

    // ✕: stops, and what was said goes; the box is empty again.
    await key.click();
    await hear(page, "Never mind the rack");
    await expect(message(page)).toHaveValue("Never mind the rack");
    // Under the words, in this order: ✕, ■ and ↑, which starts the session here.
    expect(await box.getByRole("button").evaluateAll((all) => all.map((b) => b.ariaLabel))).toEqual(
      ["Throw away what you said", "Stop listening", "Start"],
    );
    await away.click();
    await expect(key).toHaveText("TalkHold to speak");
    await expect(message(page)).toHaveValue("");
    await expect.poll(() => micOn(page)).toBe(false);
    await expect(away).toHaveCount(0);

    // ■: stops, keeping the words in the box to edit.
    await key.click();
    await hear(page, "Sintered pads or resin");
    await keep.click();
    await expect(key).toHaveText("TalkHold to speak");
    await expect.poll(() => micOn(page)).toBe(false);
    await expect(message(page)).toHaveValue("Sintered pads or resin");
    await expect(keep).toHaveCount(0);

    // ↑: sends, and stops listening. Talking again straight away, before the browser has settled
    // what it heard before ■, keeps the new words.
    await key.click();
    await hear(page, "for the Hope Tech 4s?");
    await expect(message(page)).toHaveValue("Sintered pads or resin for the Hope Tech 4s?");
    await box.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "You said: Sintered pads or resin for the Hope Tech 4s?",
    );
    await expect(key).toHaveText("TalkHold to speak");
    await expect.poll(() => micOn(page)).toBe(false);
  });

  test("the Reply box keeps its shape while it listens: its corner and width stay put, and it grows upward to six lines, then scrolls", async ({
    page,
  }) => {
    await standInSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    const box = page.locator("form", { has: message(page) });
    const before = await box.boundingBox();
    if (!before) throw new Error("no box");

    await page.getByRole("button", { name: "Talk", exact: true }).click();
    await hear(page, "Can you show the garage");
    await expect(box.getByRole("button", { name: "Stop listening" })).toBeVisible();
    const talking = await box.boundingBox();
    expect(talking).toEqual(before);

    // Long dictation: the box grows upward, its foot where it was, to six lines and no more.
    const line = 24;
    await hear(page, words(80));
    const grown = await box.boundingBox();
    if (!grown) throw new Error("no box");
    expect(grown.y + grown.height).toBeCloseTo(before.y + before.height, 0);
    expect(grown.x).toBe(before.x);
    expect(grown.width).toBe(before.width);
    const textarea = await message(page).boundingBox();
    expect(textarea?.height).toBe(6 * line);
    expect(await message(page).evaluate((area) => area.scrollHeight > area.clientHeight)).toBe(
      true,
    );
  });

  test("the box's mic talks as a tap on the Talk key does, and becomes Send once there are words", async ({
    page,
  }) => {
    await standInSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    const box = page.locator("form", { has: message(page) });
    await box.getByRole("button", { name: "Talk into the box" }).click();
    await expect(talking(page, /Tap to stop/)).toBeVisible();
    await hear(page, "Where should the rack go?");
    await box.getByRole("button", { name: "Stop listening" }).click();
    await expect(message(page)).toHaveValue("Where should the rack go?");
    await expect(box.getByRole("button", { name: "Talk into the box" })).toHaveCount(0);
    await box.getByRole("button", { name: "Start" }).click();
    await expect(session(page)).toContainText("You said: Where should the rack go?");
  });

  test("where the browser can't listen, the Talk key puts the keyboard in the box", async ({
    page,
  }) => {
    await withoutSpeechRecognition(page);
    await page.goto("/workspaces/garage-gym");
    await page.getByRole("button", { name: "Talk", exact: true }).click();
    await expect(message(page)).toBeFocused();
  });
});

// New workspace has no message box: what's said there fills in what it's for (#264).
test.describe("on New workspace, unfolded", () => {
  test.use({ viewport: SCREENS.unfolded.viewport });
  test.beforeEach(async ({ page }) => {
    await standInSpeechRecognition(page);
  });

  test("talking fills in What's it for?, after anything typed", async ({ page }) => {
    await page.goto("/new-workspace");
    const whatFor = page.getByRole("textbox", { name: "What's it for?" });
    await whatFor.fill("Pottery:");
    await talking(page, SCREENS.unfolded.idle).click();

    await hear(page, "throwing bowls on the wheel");
    await expect(whatFor).toHaveValue("Pottery: throwing bowls on the wheel");
    await talking(page, SCREENS.unfolded.listening).click();
    await expect(talking(page, SCREENS.unfolded.idle)).toBeVisible();
    await expect(whatFor).toHaveValue("Pottery: throwing bowls on the wheel");
  });
});

// #197: a computer gets the same frame, and talks hands-free: hold Space (outside a field) or the
// mouse's side button, and let go to send.
test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test.beforeEach(async ({ page }) => {
    await standInSpeechRecognition(page);
  });

  const key = (page: Page) => page.getByRole("button", { name: "Talk", exact: true });

  test("held, Space talks and letting go sends; in the box it's a space; Escape drops it", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await expect(page.getByRole("navigation", { name: "Workspaces" })).toBeVisible();
    await expect(key(page)).toContainText("Hold Space");

    await page.keyboard.down("Space");
    await expect(key(page)).toContainText("Let go to send");
    await hear(page, "Pegs for the bands");
    await page.keyboard.up("Space");
    await expect(session(page)).toContainText("You said: Pegs for the bands");

    // In the box, Space is a space.
    await message(page).click();
    await page.keyboard.type("two words");
    await expect(message(page)).toHaveValue("two words");
    await expect(key(page)).toContainText("Hold Space");
    await message(page).fill("");
    await message(page).blur();

    // Escape drops what was said.
    await page.keyboard.down("Space");
    await hear(page, "Never mind");
    await expect(message(page)).toHaveValue("Never mind");
    await page.keyboard.press("Escape");
    await page.keyboard.up("Space");
    await expect(key(page)).toContainText("Hold Space");
    await expect(message(page)).toHaveValue("");
  });

  test("the mouse's side button talks too, and isn't the browser's Back", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await expect(key(page)).toContainText("Hold Space");
    const side = (type: string) =>
      page.evaluate(
        (type) =>
          window.dispatchEvent(
            new MouseEvent(type, { button: 3, bubbles: true, cancelable: true }),
          ),
        type,
      );
    // `dispatchEvent` says false when the page prevented what the button does by default: Back.
    expect(await side("mousedown")).toBe(false);
    await expect(key(page)).toContainText("Let go to send");
    await hear(page, "Hooks for the rings");
    expect(await side("mouseup")).toBe(false);
    await expect(session(page)).toContainText("You said: Hooks for the rings");
  });

  test("in a browser that can't reach a speech service, holding Space says so and names the ones that can (#422)", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await expect(key(page)).toContainText("Hold Space");
    await page.keyboard.down("Space");
    await expect(key(page)).toContainText("Let go to send");
    await loseConnection(page);
    await page.keyboard.up("Space");
    await expect(key(page)).toContainText(CANT_LISTEN);
    await expect(session(page)).toHaveCount(0);
    await shot(page, "desktop-talk-cant-listen");
  });

  test("typing anywhere goes into the message box", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await expect(key(page)).toContainText("Hold Space");
    await page.keyboard.type("Hello there");
    await expect(message(page)).toBeFocused();
    await expect(message(page)).toHaveValue("Hello there");
  });

  test("a narrow window gets the cover screen's layout", async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 800 });
    await page.goto("/workspaces/garage-gym");
    await expect(page.getByRole("button", { name: "Type" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Talk", exact: true })).toContainText(
      "Tap or hold to talk",
    );
  });
});
