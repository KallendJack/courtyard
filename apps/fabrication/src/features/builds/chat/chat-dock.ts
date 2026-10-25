import type { Dictation, Dock, MessageBox } from "@courtyard/ui/frame/handheld.ts";
import { canListen, feel, type Listening, listen } from "@courtyard/ui/frame/speech.ts";
import { useMemo, useRef, useState } from "react";

/** Nothing to give back: what the Handheld frame offers that Fabrication's chat has no place for. */
const nothing = () => () => {};

/**
 * Where the Reply box goes in a Build's chat (#698): the foot of the chat panel, for good, since
 * Fabrication has no Handheld frame. The box's mic talks into it as the Talk key does in
 * Courtyard: a tap listens hands-free, putting the words in after anything typed, and a second tap
 * stops; ✕ drops what was said. Where the browser can't listen, the mic opens the keyboard.
 * `place` is the ref for the element the box goes in.
 */
export const useChatDock = () => {
  const [element, place] = useState<HTMLElement | null>(null);
  const box = useRef<MessageBox>(undefined);
  const talking = useRef<{ listening: Listening; dictation: Dictation }>(undefined);

  const dock = useMemo((): Dock | undefined => {
    if (element === null) return undefined;
    const stop = (how: "keep" | "drop" | "sent") => {
      const now = talking.current;
      if (now === undefined) return;
      talking.current = undefined;
      if (how === "keep") now.listening.finish();
      else now.listening.cancel();
      if (how === "drop") now.dictation.drop();
      now.dictation.done();
    };
    const start = (into: MessageBox) => {
      const dictation = into.dictate({ stop });
      let over = false;
      const listening = listen({
        heard: (words) => dictation.hear(words),
        // The browser's last word on what was said, once it has settled.
        finished: (words) => {
          if (words !== "") dictation.hear(words);
        },
        failed: (_problem, words) => {
          over = true;
          if (talking.current?.dictation === dictation) talking.current = undefined;
          // Nothing said is lost: it waits in the box, to send or finish by keyboard.
          if (words !== "") dictation.hear(words);
          dictation.done();
        },
      });
      if (!over) talking.current = { listening, dictation };
    };
    return {
      element,
      offer: (offered) => {
        box.current = offered;
        return () => {
          if (box.current === offered) box.current = undefined;
        };
      },
      offerField: nothing,
      offerAdd: nothing,
      // The box is always open in the chat panel.
      open: () => {},
      close: () => {},
      chooseModel: () => {},
      talk: () => {
        const into = box.current;
        if (into === undefined) return;
        if (!canListen()) return into.focus();
        if (talking.current !== undefined) {
          feel("doubleTick");
          return stop("keep");
        }
        feel("thump");
        start(into);
      },
    };
  }, [element]);

  return { dock, place };
};
