import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Which frame the app is in (#193): the Handheld frame everywhere (#197), by the window's width
 * alone, whatever the device: thumb rails from 600 px (a tablet, the unfolded Fold, a computer),
 * and the cover-screen layout below (a phone, the folded Fold, a narrow window).
 */
export type Layout = "tablet" | "cover";

const COVER = "(max-width: 599.98px)";
/** A window wide enough for a page's wide version beside the rails (the PR page's panel). */
const WIDE = "(min-width: 1280px)";
/**
 * From a tablet up (Tailwind's `md`), where a Home block's height is its share of the page's, not
 * two rows (#398, `Block`'s `fill`).
 */
const BLOCKS_FILL = "(min-width: 48rem)";
/** A mouse or trackpad: where a keyboard is likely and won't cover the page. */
const FINE = "(pointer: fine)";

/** Follows a media query as it changes. */
const useQuery = (query: string) =>
  useSyncExternalStore(
    (changed) => {
      const watched = matchMedia(query);
      watched.addEventListener("change", changed);
      return () => watched.removeEventListener("change", changed);
    },
    () => matchMedia(query).matches,
  );

/** The frame the app is in now, following the screen as the Fold folds and unfolds. */
export const useLayout = (): Layout => (useQuery(COVER) ? "cover" : "tablet");

/** Whether the window has room for a page's wide version beside the rails. */
export const useWide = () => useQuery(WIDE);

/** Whether Home's blocks take their share of the page's height, so their size is the layout's. */
export const useBlocksFill = () => useQuery(BLOCKS_FILL);

/** Whether there's a mouse or trackpad, so likely a keyboard, which won't cover the page. */
export const useFinePointer = () => useQuery(FINE);

/** Whether the keyboard is in something that takes text, where a key is the field's own. */
export const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Where the talk strip and the Talk key put what the owner says: the page's message box, or on a
 * page without one, the one field a page offers for talking into (New workspace's What's it for?,
 * #264).
 */
export type TalkTarget = {
  /** Puts the keyboard there, where the browser can't listen. */
  focus: () => void;
  /** A turn is running, so what's sent now is queued until it ends (#177). */
  answering: boolean;
  /** While it answers, what's sent goes into that answer (#252) rather than the queue. */
  steers?: boolean;
  /**
   * Takes what the owner says in the talk strip or to the Talk key (#79, #198, #206), which goes
   * in after anything typed. Once it's done with it (the box sent it), it tells `listener`, so
   * listening stops.
   */
  dictate: (listener: Listener) => Dictation;
  /**
   * What the talk strip and the Talk key say to say, in place of where the owner is or how to
   * talk: step by step's Say “next” (#241).
   */
  hint?: string;
};

/** What a page's message box offers the Handheld frame's buttons. */
export type MessageBox = TalkTarget & {
  chooseModel: () => void;
  /** Only when the workspace has skills. */
  chooseSkill?: () => void;
  /** The model it sends with, in a word or two ("Sonnet 5"). */
  model: string;
  /** Which of its sheets is open, so the button that opened it shows lit (#194). */
  choosing?: "skill" | "model";
};

/** What's listening for the message box or a page's field: the talk strip, or the Talk key. */
export type Listener = {
  /** Stops listening: keeping what was said, dropping it, or because the box sent it. */
  stop: (how: "keep" | "drop" | "sent") => void;
};

/** What the owner says, going into the message box as it's heard. */
export type Dictation = {
  /** The words heard so far, put in the box after what was typed before listening. */
  hear: (words: string) => void;
  /** Drops what this listen said, leaving what was typed before it. */
  drop: () => void;
  /** Listening has stopped, however it stopped. */
  done: () => void;
  /** Sends what's in the box now, as ↑ does: where a held key let go sends (#197). */
  send?: () => void;
};

/**
 * Where the page's message box goes in the Handheld frame: above its bottom bar, shown when the
 * owner taps Type or the talk strip, gone again once the message is sent or they tap away.
 */
export type Dock = {
  element: HTMLElement;
  /** The page's message box, offered to the frame's buttons until the returned function is called. */
  offer: (box: MessageBox) => () => void;
  /**
   * A field to talk into, on a page without a message box (#264), offered to the talk strip and
   * the Talk key until the returned function is called. The page's message box comes first.
   */
  offerField: (field: TalkTarget) => () => void;
  /**
   * What a page listens for while it's in a mode the owner steers by voice (step by step's "next",
   * "back" and "repeat", #241), offered to the talk strip and the Talk key ahead of the message box
   * until the returned function is called.
   */
  offerCommands: (commands: TalkTarget) => () => void;
  open: () => void;
  close: () => void;
  /**
   * Talks into the box as a tap on the Talk key does (#251, the box's mic): listening hands-free,
   * or stopping and keeping what was said.
   */
  talk: () => void;
  /** Opens the message box's Model sheet, as the frame's Model button does (#66). */
  chooseModel: () => void;
};

export const DockContext = createContext<Dock | undefined>(undefined);

/** The Handheld frame's dock, or nothing on a desktop, where the box stays in the page. */
export const useDock = () => useContext(DockContext);
