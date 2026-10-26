import type { Page } from "@playwright/test";

/**
 * A stand-in for the browser's speech recognition and vibration, for Chromium as Playwright runs
 * it, which has no microphone to listen with and nothing to vibrate. The test speaks for the owner
 * (`hear`), and can make it stop on its own in a pause as Chrome on Android does (`pause`), or
 * refuse the microphone (`refuse`), or fail to reach its speech service (`loseConnection`), or
 * send the page out of sight (`goOutOfSight`) and back
 * (`comeBack`), or take its time settling the words when asked to stop (`settleSlowly`, until
 * `settle`). It stands in for the screen's wake lock too, released out of sight as browsers do.
 * What the page asked for (the language, the phrases to listen out for, the microphone on or off,
 * each vibration, the screen kept awake) is kept in the page's storage for the test to read. Everything from the words on (the talk strip, the
 * message sent) is real.
 */
export const standInSpeechRecognition = (page: Page) =>
  page.addInitScript(() => {
    type Heard = { transcript: string; confidence: number }[] & { isFinal: boolean };
    type Handler = ((event: unknown) => void) | null;

    let listening: StandIn | undefined;
    /** Words said while nothing listened (between a pause and listening again), heard once it does. */
    let unheard: string | undefined;
    /** Settling slowly: asked to stop, it stops listening but ends only once told to settle. */
    let slowly = false;
    let unsettled: StandIn | undefined;

    class StandIn {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: Handler = null;
      onerror: Handler = null;
      onend: Handler = null;
      phrases: { phrase: string; boost: number }[] = [];
      results: Heard[] = [];

      start() {
        listening = this;
        localStorage.setItem("stand-in-speech-lang", this.lang);
        localStorage.setItem(
          "stand-in-phrases",
          JSON.stringify(this.phrases.map((each) => each.phrase)),
        );
        localStorage.setItem("stand-in-mic", "on");
        const words = unheard;
        unheard = undefined;
        if (words !== undefined) setTimeout(() => this.hear(words), 50);
      }
      /** Hears the words so far, as a result still being worked out, in place of the last one. */
      hear(words: string) {
        const last = this.results.at(-1);
        if (last !== undefined && !last.isFinal) this.results.pop();
        this.results.push(
          Object.assign([{ transcript: words, confidence: 0.9 }], { isFinal: false }),
        );
        this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
      }
      /**
       * Hears the whole phrase so far as a new result, kept beside the earlier ones, as Chrome on
       * Android does: "hi", then "hi I", then "hi I just", often settled as each comes.
       */
      hearAnew(words: string, final: boolean) {
        this.results.push(
          Object.assign([{ transcript: words, confidence: 0.9 }], { isFinal: final }),
        );
        this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
      }
      /** Settles the last words and ends, as the browser does when asked to stop or in a pause. */
      end() {
        if (listening === this) stopListening();
        setTimeout(() => {
          const last = this.results.at(-1);
          if (last !== undefined && !last.isFinal) {
            last.isFinal = true;
            this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
          }
          this.onend?.({});
        }, 50);
      }
      stop() {
        if (!slowly) return this.end();
        if (listening === this) stopListening();
        unsettled = this;
      }
      abort() {
        if (listening === this) stopListening();
        setTimeout(() => {
          this.onerror?.({ error: "aborted" });
          this.onend?.({});
        }, 50);
      }
    }

    const stopListening = () => {
      listening = undefined;
      localStorage.setItem("stand-in-mic", "off");
    };

    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, { configurable: true, value: StandIn });
    }
    /** A phrase the page says is likely, to bias what's heard towards it. */
    class Phrase {
      phrase: string;
      boost: number;
      constructor(phrase: string, boost = 1) {
        this.phrase = phrase;
        this.boost = boost;
      }
    }
    Object.defineProperty(window, "SpeechRecognitionPhrase", { configurable: true, value: Phrase });
    addEventListener("stand-in-hear", (event) => {
      if (!(event instanceof CustomEvent && typeof event.detail === "string")) return;
      if (listening === undefined) unheard = event.detail;
      else listening.hear(event.detail);
    });
    addEventListener("stand-in-hear-anew", (event) => {
      if (!(event instanceof CustomEvent)) return;
      const { words, final }: { words: unknown; final: unknown } = event.detail;
      if (typeof words === "string") listening?.hearAnew(words, final === true);
    });
    addEventListener("stand-in-pause", () => listening?.end());
    addEventListener("stand-in-settle-slowly", () => {
      slowly = true;
    });
    addEventListener("stand-in-settle", () => {
      slowly = false;
      unsettled?.end();
      unsettled = undefined;
    });
    /** The screen's wake locks the page holds, as the browser keeps them. */
    const locks = new Set<{ released: boolean; release: () => Promise<void> }>();
    const keptAwake = () => localStorage.setItem("stand-in-awake", locks.size > 0 ? "yes" : "no");
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async (type: string) => {
          if (type !== "screen" || document.visibilityState !== "visible") {
            throw new DOMException("Not allowed", "NotAllowedError");
          }
          const lock = {
            released: false,
            release: async () => {
              lock.released = true;
              locks.delete(lock);
              keptAwake();
            },
          };
          locks.add(lock);
          keptAwake();
          return lock;
        },
      },
    });

    addEventListener("stand-in-hide", () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      // Out of sight, the browser lets the screen sleep: it releases every wake lock.
      for (const lock of locks) void lock.release();
      document.dispatchEvent(new Event("visibilitychange"));
    });
    addEventListener("stand-in-show", () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    /** Listening ends at once, for the browser's reason. */
    const endWith = (error: string) => {
      const ended = listening;
      stopListening();
      ended?.onerror?.({ error });
      ended?.onend?.({});
    };
    addEventListener("stand-in-refuse", () => endWith("not-allowed"));
    addEventListener("stand-in-lose-connection", () => endWith("network"));

    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: VibratePattern) => {
        const buzzes: unknown = JSON.parse(localStorage.getItem("stand-in-buzzes") ?? "[]");
        localStorage.setItem(
          "stand-in-buzzes",
          JSON.stringify([...(Array.isArray(buzzes) ? buzzes : []), pattern]),
        );
        return true;
      },
    });
  });

/** A browser with no speech recognition at all, as Firefox is. */
export const withoutSpeechRecognition = (page: Page) =>
  page.addInitScript(() => {
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Reflect.deleteProperty(window, name);
      Reflect.deleteProperty(Window.prototype, name);
    }
  });

/** The owner says `words` (so far): what the browser has heard of them. */
export const hear = (page: Page, words: string) =>
  page.evaluate((detail) => dispatchEvent(new CustomEvent("stand-in-hear", { detail })), words);

/**
 * The owner says `words` (so far), heard as Chrome on Android hears them: the whole phrase again
 * as a new result each time, `final` or not.
 */
export const hearAnew = (page: Page, words: string, final: boolean) =>
  page.evaluate((detail) => dispatchEvent(new CustomEvent("stand-in-hear-anew", { detail })), {
    words,
    final,
  });

/** The browser stops listening on its own, as Chrome on Android does in a pause. */
export const pause = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-pause")));

/**
 * The browser takes its time settling the words once asked to stop, as Chrome on Android can:
 * listening has stopped, but the words aren't handed over until `settle`.
 */
export const settleSlowly = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-settle-slowly")));

/** The browser settles the words it was asked to stop on, and hands them over. */
export const settle = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-settle")));

/** The owner, or the browser, says no to the microphone. */
export const refuse = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-refuse")));

/**
 * The browser can't reach its speech service: the connection dropped, or a Chromium browser
 * without Google's (Vivaldi, Brave, Opera), where every listen ends like this at once (#422).
 */
export const loseConnection = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-lose-connection")));

/** The owner switches away from Courtyard, or the screen goes off: the page is out of sight. */
export const goOutOfSight = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-hide")));

/** Courtyard comes back into sight. */
export const comeBack = (page: Page) =>
  page.evaluate(() => dispatchEvent(new CustomEvent("stand-in-show")));

/** Whether the page is keeping the screen awake: it holds a screen wake lock. */
export const screenKeptAwake = (page: Page) =>
  page.evaluate(() => localStorage.getItem("stand-in-awake") === "yes");

/** Whether the microphone is on: something is listening. */
export const micOn = (page: Page) =>
  page.evaluate(() => localStorage.getItem("stand-in-mic") === "on");

/** The phrases the page last told the recogniser to listen out for. */
export const listenedFor = (page: Page) =>
  page.evaluate((): unknown => JSON.parse(localStorage.getItem("stand-in-phrases") ?? "[]"));

/** The language the page last listened in. */
export const listenedIn = (page: Page) =>
  page.evaluate(() => localStorage.getItem("stand-in-speech-lang"));

/** Each vibration the page has asked the phone for, in milliseconds, in order. */
export const vibrations = (page: Page) =>
  page.evaluate((): unknown[] => {
    const kept: unknown = JSON.parse(localStorage.getItem("stand-in-buzzes") ?? "[]");
    return Array.isArray(kept) ? kept : [];
  });

/** How many times the page has asked the phone to vibrate. */
export const buzzes = async (page: Page) => (await vibrations(page)).length;
