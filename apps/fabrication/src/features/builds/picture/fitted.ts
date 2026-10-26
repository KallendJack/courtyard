import { type RefObject, useEffect, useState } from "react";

// Where a close-up's drawing sits in its box (`close-up.tsx`), so its words can be placed over it
// at their own size: out of close-up.tsx (over 400 lines).

/** Where a drawing's mm land in its box once fitted: its scale, in px a mm, and its top left. */
export type Fitted = { scale: number; left: number; top: number };

/**
 * How a drawing of `view` (its viewBox) sits in `host`, kept as the host is resized: in the
 * middle, or at its left (`start`), so words that run on past it have the room to its right.
 */
export const useFitted = (
  host: RefObject<HTMLDivElement | null>,
  view: { w: number; h: number },
  start: boolean,
): Fitted | undefined => {
  const [fitted, setFitted] = useState<Fitted>();
  useEffect(() => {
    const box = host.current;
    if (box === null) return;
    const read = () => {
      const { clientWidth: width, clientHeight: height } = box;
      const scale = Math.min(width / view.w, height / view.h);
      setFitted({
        scale,
        left: start ? 0 : (width - view.w * scale) / 2,
        top: (height - view.h * scale) / 2,
      });
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(box);
    return () => watch.disconnect();
  }, [host, view.w, view.h, start]);
  return fitted;
};
