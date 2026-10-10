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

/** What a page's message box offers the Handheld frame's buttons. */
export type MessageBox = {
  /** Puts the keyboard in the box. */
  focus: () => void;
  /** Opens the photo picker (the paperclip's). */
  pickPhotos: () => void;
  chooseModel: () => void;
  /** Only when the workspace has skills. */
  chooseSkill?: () => void;
  /** The model it sends with, in a word or two ("Sonnet 5"). */
  model: string;
  /** A turn is running, so what's sent now is queued until it ends (#177). */
  answering: boolean;
  /**
   * Sends what the owner said in the talk strip (#79), after anything they'd typed, as Send would.
   * When it can't go, it waits in the opened box, saying why.
   */
  say: (words: string) => void;
  /** Puts what the owner said in the box, after anything typed, to finish by keyboard. */
  write: (words: string) => void;
};

/**
 * Where the page's message box goes in the Handheld frame: above its bottom bar, shown when the
 * owner taps Type or the talk strip, gone again once the message is sent or they tap away.
 */
export type Dock = {
  element: HTMLElement;
  /** The page's message box, offered to the frame's buttons until the returned function is called. */
  offer: (box: MessageBox) => () => void;
  open: () => void;
  close: () => void;
};

export const DockContext = createContext<Dock | undefined>(undefined);

/** The Handheld frame's dock, or nothing on a desktop, where the box stays in the page. */
export const useDock = () => useContext(DockContext);
