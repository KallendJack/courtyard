import {
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { classes } from "@/lib/classes";

/** Which way it scrolls. */
const AXES = {
  y: { always: "overflow-y-auto", tablet: "md:overflow-y-auto" },
  x: { always: "overflow-x-auto", tablet: "md:overflow-x-auto" },
  both: { always: "overflow-auto", tablet: "md:overflow-auto" },
} as const;

/** Where it fades: at its top with more above, at its foot with more below (`fadeEnd`), or both. */
type Fade = "top" | "end" | "both";

/**
 * Everything that scrolls in the web app (#420): one look, from Home's blocks (#335, #408). A thin
 * thumb rather than the system's wide scrollbar with arrows, and, scrolled down, a fade at its top
 * that says there's more above, so what scrolls under a pinned header (a session's title, a
 * sheet's) is never cut off by a hard line. Sideways it has the thin thumb only. The fade is a
 * mask (styles.css), so it shows whatever is behind: it draws nothing itself, and a border or
 * background goes on a box around it, which the fade leaves be. While what's in it is taller than
 * it, it's `data-overflows`, so what's in it can make room for the thumb. Nothing else sets
 * `overflow-*` to scroll (`scripts/theme/check.ts`).
 */
export function Scroller({
  as: Tag = "div",
  axis = "y",
  from,
  fadeEnd,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children" | "onScroll"> & {
  children: ReactNode;
  /** The element it is, for what it holds: the page's `main`, a `nav` of links. */
  as?: "div" | "main" | "nav" | "figure" | "pre";
  /** Down (the default), sideways, or both (a diff's lines). */
  axis?: keyof typeof AXES;
  /** Only from a tablet up: on a phone it grows with what's in it, and the page scrolls instead. */
  from?: "tablet";
  /** A fade at its foot too while there's more below (Home's blocks; Paper, Components, "A block with more rows than fit"). */
  fadeEnd?: boolean;
  /** Its size, and how it lays out what's in it. Never a border or a background. */
  className?: string;
  ref?: Ref<HTMLElement>;
}) {
  const own = useRef<HTMLElement | null>(null);
  const fades = axis !== "x";
  const { fade, overflows, measure } = useScrollFade(own, {
    on: fades,
    end: fadeEnd === true,
    watchChildren: true,
  });

  const attach = useCallback(
    (node: HTMLElement | null) => {
      own.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <Tag
      {...rest}
      ref={attach}
      onScroll={fades ? measure : undefined}
      {...scrollFadeAttributes({ fade, overflows })}
      className={classes(
        "scroll-thin",
        from === "tablet" ? AXES[axis].tablet : AXES[axis].always,
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * What says how a box that scrolls itself fades (#420): `fade` while there's more above (or, with
 * `end`, below), and `overflows` while what's in it is taller than it, measured as it scrolls,
 * resizes, and (`watchChildren`) as what's in it changes. The `Scroller` uses it, and so does the
 * one box that scrolls without being one, the composer's message box (#469), whose text scrolls
 * inside it.
 */
export const useScrollFade = (
  box: RefObject<HTMLElement | null>,
  options: { on: boolean; end: boolean; watchChildren: boolean },
) => {
  const { on, end, watchChildren } = options;
  const [fade, setFade] = useState<Fade>();
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const element = box.current;
    if (element === null || !on) return;
    setOverflows(element.scrollHeight > element.clientHeight + 1);
    const above = element.scrollTop > 1;
    const below = end && element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    setFade(above ? (below ? "both" : "top") : below ? "end" : undefined);
  }, [box, on, end]);

  // Scrolling says when there's more above. Its own size changing can too (a tablet's scroller is
  // a phone's plain column once narrower), and what's in it changing says when there's more below.
  useEffect(() => {
    const element = box.current;
    if (element === null || !on) return;
    measure();
    const resized = new ResizeObserver(measure);
    const watch = () => {
      resized.disconnect();
      resized.observe(element);
      if (watchChildren) for (const child of element.children) resized.observe(child);
    };
    watch();
    const changed = new MutationObserver(watch);
    if (watchChildren) changed.observe(element, { childList: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [box, on, watchChildren, measure]);

  return { fade, overflows, measure };
};

/** The attributes `styles.css` fades a box by, and that say it overflows. */
export const scrollFadeAttributes = ({
  fade,
  overflows,
}: {
  fade: Fade | undefined;
  overflows: boolean;
}) => ({ "data-fade": fade, "data-overflows": overflows ? "" : undefined });
