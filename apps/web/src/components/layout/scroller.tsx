import {
  type HTMLAttributes,
  type ReactNode,
  type Ref,
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
  const [fade, setFade] = useState<Fade>();
  const [overflows, setOverflows] = useState(false);
  const fades = axis !== "x";

  const measure = useCallback(() => {
    const box = own.current;
    if (box === null || !fades) return;
    setOverflows(box.scrollHeight > box.clientHeight + 1);
    const above = box.scrollTop > 1;
    const below = fadeEnd === true && box.scrollTop + box.clientHeight < box.scrollHeight - 1;
    setFade(above ? (below ? "both" : "top") : below ? "end" : undefined);
  }, [fades, fadeEnd]);

  // Scrolling says when there's more above. Its own size changing can too (a tablet's scroller is
  // a phone's plain column once narrower), and what's in it changing says when there's more below.
  useEffect(() => {
    const box = own.current;
    if (box === null || !fades) return;
    measure();
    const resized = new ResizeObserver(measure);
    const watch = () => {
      resized.disconnect();
      resized.observe(box);
      for (const child of box.children) resized.observe(child);
    };
    watch();
    const changed = new MutationObserver(watch);
    changed.observe(box, { childList: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [fades, measure]);

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
      data-fade={fade}
      data-overflows={overflows ? "" : undefined}
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
