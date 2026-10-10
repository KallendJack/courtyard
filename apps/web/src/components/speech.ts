/**
 * Listening to the owner through the browser's own speech recognition (#79, the Web Speech API),
 * and the phone's vibration for the talk strip's haptics. Only the Handheld frame uses it, so it
 * loads with the frame. Chrome on Android hands what's said to its speech service and gives back
 * the words; nothing else reaches Courtyard.
 */

/** The part of the browser's recogniser this uses. TypeScript's DOM types leave it out. */
type Recogniser = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => Recogniser;
    webkitSpeechRecognition?: new () => Recogniser;
  }
}

const recogniser = () => window.SpeechRecognition ?? window.webkitSpeechRecognition;

/** Whether this browser can listen (Chrome can; Firefox can't). */
export const canListen = () => recogniser() !== undefined;

/** What the owner is told when listening can't go on, by the browser's reason. */
const PROBLEMS: Partial<Record<SpeechRecognitionErrorCode, string>> = {
  "not-allowed": "The microphone isn't allowed. Allow it in the browser's site settings",
  "service-not-allowed": "The browser's speech service isn't allowed. Check its settings",
  "audio-capture": "No microphone to listen with",
  network: "Speech recognition needs a connection",
  "language-not-supported": "This browser can't listen in British English",
};

/** How soon, and how many times running, a recogniser can end on its own before listening gives up. */
const QUICK_END_MS = 1000;
const QUICK_ENDS = 3;
/** How long listening goes on with nothing new heard before it stops, so the microphone isn't left on. */
const QUIET_MS = 20_000;

export type Listening = {
  /** Stops listening and hands over everything heard, once the browser has settled the words. */
  finish: () => void;
  /** Stops listening and drops what was heard. */
  cancel: () => void;
};

/**
 * Listens until finished or cancelled, in British English, telling `heard` the words so far as
 * they come. Chrome on Android stops on its own in a pause; this starts it again, keeping what was
 * said, so the owner can think mid-sentence, but not for ever: with nothing new heard for a while,
 * it stops, and when Courtyard goes out of sight. When it can't listen (the microphone refused,
 * say) or stops like that, `failed` hears why, with the words heard until then.
 */
export const listen = (on: {
  heard: (words: string) => void;
  finished: (words: string) => void;
  failed: (problem: string, words: string) => void;
}): Listening => {
  const Recogniser = recogniser();
  /** The words of the recognisers that have ended, and of the one listening now. */
  let before = "";
  let now = "";
  let state: "listening" | "finishing" | "done" = "listening";
  let current: Recogniser | undefined;
  let quickEnds = 0;
  let quiet: number | undefined;
  const words = () => tidy(`${before} ${now}`);

  /** Listening is over: no more starting again, and the microphone goes off. */
  const done = () => {
    state = "done";
    window.clearTimeout(quiet);
    document.removeEventListener("visibilitychange", outOfSight);
  };
  const fail = (problem: string) => {
    done();
    current?.abort();
    on.failed(problem, words());
  };
  /** Something new was heard, or listening began: the quiet starts again from now. */
  const heardNow = () => {
    window.clearTimeout(quiet);
    quiet = window.setTimeout(() => {
      if (state === "listening") fail("Nothing heard for a while, so it stopped listening");
    }, QUIET_MS);
  };

  const start = () => {
    if (Recogniser === undefined) return;
    const recognition = new Recogniser();
    current = recognition;
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const was = words();
      now = Array.from({ length: event.results.length }, (_, at) => {
        return event.results[at]?.[0]?.transcript ?? "";
      }).join(" ");
      if (state !== "listening" || words() === was) return;
      heardNow();
      on.heard(words());
    };
    recognition.onerror = (event) => {
      const problem = PROBLEMS[event.error];
      // A pause with nothing said ends it like any other, and "aborted" is a cancel.
      if (problem === undefined || state === "done") return;
      fail(problem);
    };
    const started = performance.now();
    recognition.onend = () => {
      if (recognition !== current) return;
      // One that ends as soon as it starts, again and again, isn't going to listen.
      quickEnds = now === "" && performance.now() - started < QUICK_END_MS ? quickEnds + 1 : 0;
      before = words();
      now = "";
      if (state === "listening" && quickEnds >= QUICK_ENDS) {
        fail("The browser keeps stopping listening");
      } else if (state === "listening") start();
      else if (state === "finishing") {
        done();
        on.finished(before);
      }
    };
    try {
      recognition.start();
    } catch {
      fail("The browser couldn't start listening");
    }
  };
  /** Switched away from, or the screen gone off: nobody's there to talk, so it stops. */
  function outOfSight() {
    if (document.visibilityState === "hidden" && state !== "done") {
      fail("Stopped listening when Courtyard went out of sight");
    }
  }

  if (Recogniser === undefined) on.failed("This browser can't listen", "");
  else {
    document.addEventListener("visibilitychange", outOfSight);
    heardNow();
    start();
  }

  return {
    finish: () => {
      if (state !== "listening") return;
      state = "finishing";
      window.clearTimeout(quiet);
      current?.stop();
    },
    cancel: () => {
      if (state === "done") return;
      done();
      current?.abort();
    },
  };
};

const tidy = (words: string) => words.replace(/\s+/g, " ").trim();

/** The talk strip's haptics (Paper board Handheld · 02), in milliseconds of vibration. */
const FEELS = {
  /** A finger on the strip. */
  tick: 10,
  /** Listening has started. */
  thump: 35,
  /** Let go, so it's sent. */
  doubleTick: [12, 70, 12],
  /** The answer has finished. */
  softTick: 6,
} satisfies Record<string, VibratePattern>;

/**
 * Vibrates as the talk strip changes, where the phone can (Android can from the web; an iPhone
 * can't), and never when the device asks for less motion.
 */
export const feel = (what: keyof typeof FEELS) => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("vibrate" in navigator)) return;
  navigator.vibrate(FEELS[what]);
};
