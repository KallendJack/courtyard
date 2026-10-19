import { type ReactNode, useState } from "react";
import { classes } from "@/lib/classes";
import { useLayout } from "../frame/handheld.ts";
import { PAGE_SCROLL, PageScrollContext } from "./page-scroll.ts";
import { Scroller } from "./scroller.tsx";

/**
 * A screen (#339): a pinned header, one scrolling middle and a pinned footer, filling the raised
 * panel, so nothing scrolls the title or the main action away. Only the middle scrolls, and no
 * other box on the screen scrolls it: what follows the scroll (a session's turns) finds it through
 * `usePageScroll`. Scrolled down, its top fades under the header, never a line cut in half (#420).
 * The cover screen is too short to pin a header too, so there the header scrolls
 * with the middle as one column, and only the footer stays put.
 */
export function Page(props: {
  /** The middle, which scrolls. */
  children: ReactNode;
  /** Pinned at the top: the title, and what goes with it (a back link, tabs). */
  header?: ReactNode;
  /** Pinned at the foot: the main action (the message box, Save, Create). */
  footer?: ReactNode;
  /**
   * The panel's whole width rather than a reading column, for a page of cards (a workspace's),
   * which lays them out by its own width: a column on a phone, two once there's room.
   */
  wide?: boolean;
  /**
   * From a tablet up, the middle is exactly the room left and its content no taller (#335): what's
   * in it shares that height and scrolls inside its own cards (a code workspace's Home).
   */
  fill?: boolean;
}) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const oneColumn = useLayout() === "cover";
  // From a tablet up the page sits straight on the frame, its title near the top (#503).
  const column = classes(
    "mx-auto flex w-full flex-col px-4 md:px-5",
    props.wide ? "@container max-w-5xl" : "max-w-reading",
  );
  const header = props.header !== undefined && (
    <div className={classes(column, "shrink-0 pt-6 md:pt-5")}>{props.header}</div>
  );
  return (
    <main className="flex h-full min-h-0 flex-col">
      {!oneColumn && header}
      <Scroller
        ref={setScroller}
        data-scroll-restoration-id={PAGE_SCROLL}
        className="flex min-h-0 flex-1 flex-col"
      >
        {oneColumn && header}
        <div
          className={classes(
            column,
            "grow",
            props.fill && "md:min-h-0",
            props.header === undefined && "pt-6 md:pt-5",
            props.footer === undefined && "pb-10",
          )}
        >
          <PageScrollContext value={scroller}>{props.children}</PageScrollContext>
        </div>
      </Scroller>
      {props.footer !== undefined && (
        // Where Jump to latest floats from, just above the message box.
        <div className={classes(column, "relative shrink-0")}>{props.footer}</div>
      )}
    </main>
  );
}

/**
 * What a workspace's Home puts on its title's row: a line under the name, its tabs, and a planning
 * workspace's photo in the top right corner (#481).
 */
export type TitleBeside = { under?: ReactNode; tabs?: ReactNode; photo?: ReactNode };

/**
 * A page's title, with an optional line above it (a workspace chip, say), buttons beside it
 * (rename, say), and a workspace's line under its name and its tabs. From a tablet up the tabs and
 * the buttons share the title's row, on its right (#503; Paper, "Tablet · Code Home, roomier on
 * the Fold"), and a long name wraps rather than push them off; on the cover screen, with no room
 * beside it, the tabs go under the name and its line.
 */
export function PageTitle(
  props: { children: ReactNode; above?: ReactNode; actions?: ReactNode } & TitleBeside,
) {
  const tabbed = props.tabs !== undefined && props.tabs !== false;
  const title = (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start md:grid-cols-[minmax(0,1fr)_auto_auto]">
      <h1 className="display-title col-start-1 row-start-1 text-title wrap-anywhere md:text-3xl xl:text-4xl/10.5">
        {props.children}
      </h1>
      {props.under && (
        <div className="col-span-2 row-start-2 mt-2 md:col-span-1 md:mt-1.5">{props.under}</div>
      )}
      {tabbed && (
        <div className="col-span-2 row-start-3 mt-3.5 min-w-0 md:col-span-1 md:col-start-2 md:row-span-2 md:row-start-1 md:mt-0 md:self-end md:pl-4">
          {props.tabs}
        </div>
      )}
      {props.actions && (
        <div
          className={classes(
            "col-start-2 row-start-1 flex shrink-0 gap-1 pl-3 md:col-start-3",
            tabbed ? "md:row-span-2 md:self-end md:pl-1" : "md:pt-1",
          )}
        >
          {props.actions}
        </div>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {props.above}
      {props.photo === undefined ? (
        title
      ) : (
        <div className="flex items-start gap-3 md:gap-4">
          <div className="min-w-0 grow">{title}</div>
          {props.photo}
        </div>
      )}
    </div>
  );
}

/** A section heading inside a page. */
export function SectionTitle(props: { children: ReactNode }) {
  return <h2 className="display-section text-xl/7">{props.children}</h2>;
}

/** A card on a wide page: one of a workspace's sections (its sessions, context file, Things). */
export const CARD = "rounded-2xl bg-surface p-4 md:p-5";

/** A row in a page's list (workspaces, sessions): the whole row is the link. */
export const LIST_ROW =
  "-mx-2 flex items-baseline justify-between gap-4 rounded-md px-2 py-3.5 hover:bg-muted/60";
