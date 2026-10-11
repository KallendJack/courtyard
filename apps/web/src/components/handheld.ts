import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Which frame the app is in (#193): a desktop's sidebar, or on a touch screen the Handheld frame,
 * with thumb rails on a tablet or the unfolded Fold, and the cover-screen layout on a phone or the
 * folded Fold. A narrow window on a desktop keeps the desktop's own strip.
 */
export type Layout = "desktop" | "tablet" | "cover";

const TABLET = "(pointer: coarse) and (min-width: 600px)";
const COVER = "(pointer: coarse) and (max-width: 599.98px)";

const queries = () => [matchMedia(TABLET), matchMedia(COVER)] as const;

const subscribe = (changed: () => void) => {
  const watched = queries();
  for (const query of watched) query.addEventListener("change", changed);
  return () => {
    for (const query of watched) query.removeEventListener("change", changed);
  };
};

const layoutNow = (): Layout => {
  const [tablet, cover] = queries();
  return tablet.matches ? "tablet" : cover.matches ? "cover" : "desktop";
};

/** The frame the app is in now, following the screen as the Fold folds and unfolds. */
export const useLayout = () => useSyncExternalStore(subscribe, layoutNow);

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
  /**
   * Takes what the owner says in the talk strip or to the Talk key (#79, #198, #206), which goes
   * in after anything typed. Once it's done with it (the box sent it), it tells `listener`, so
   * listening stops.
   */
  dictate: (listener: Listener) => Dictation;
};

/** What a page's message box offers the Handheld frame's buttons. */
export type MessageBox = TalkTarget & {
  /** Opens the photo picker (the paperclip's). */
  pickPhotos: () => void;
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
  /**
   * The box shows ✕, ■ and ↑ under the words while it listens (#206): for the Talk key, which has
   * no Cancel beside it as the strip has.
   */
  controls: boolean;
};

/** What the owner says, going into the message box as it's heard. */
export type Dictation = {
  /** The words heard so far, put in the box after what was typed before listening. */
  hear: (words: string) => void;
  /** Drops what this listen said, leaving what was typed before it. */
  drop: () => void;
  /** Listening has stopped, however it stopped. */
  done: () => void;
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
  open: () => void;
  close: () => void;
};

export const DockContext = createContext<Dock | undefined>(undefined);

/** The Handheld frame's dock, or nothing on a desktop, where the box stays in the page. */
export const useDock = () => useContext(DockContext);
