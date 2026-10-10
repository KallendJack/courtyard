import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

/** A page's reading column inside the raised panel. */
export function Page(props: {
  children: ReactNode;
  /** No space below: the page ends with something pinned to the bottom (the message box). */
  flushBottom?: boolean;
  /**
   * The panel's whole width rather than a reading column, for a page of cards (a workspace's),
   * which lays them out by its own width: a column on a phone, two once there's room.
   */
  wide?: boolean;
}) {
  return (
    <main
      className={classes(
        "mx-auto flex w-full flex-col px-4 pt-6 md:px-8 md:pt-12",
        props.wide ? "@container max-w-5xl" : "max-w-reading",
        !props.flushBottom && "pb-10",
      )}
    >
      {props.children}
    </main>
  );
}

/**
 * A page's title, with an optional line above it (a workspace chip, say) and buttons beside it
 * (rename, say).
 */
export function PageTitle(props: { children: ReactNode; above?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {props.above}
      <div className="flex items-start justify-between gap-3">
        <h1 className="display-title text-[26px]/[31px] wrap-anywhere md:text-[30px]/[36px] xl:text-4xl/[42px]">
          {props.children}
        </h1>
        {props.actions && <div className="flex shrink-0 gap-1 md:pt-1">{props.actions}</div>}
      </div>
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
