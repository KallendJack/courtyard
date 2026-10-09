import { ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { classes } from "@/lib/classes";
import { PILL_QUIET, PILL_SHAPE } from "./select.tsx";

/**
 * A small quiet pill saying what's chosen, which opens a sheet or a list to change it (the model
 * above a phone's message box, the Skill pill): the same pill as the pickers it sits among. Its
 * text is its name. Safe on the first load (ADR 0012).
 */
export function Chip(props: {
  children: string;
  onClick: () => void;
  /** Only from tablet width up: on a narrow screen another chip offers the choice. */
  wideOnly?: boolean;
  /** An icon before its text, in place of the chevron after it (the Skill pill's book). */
  icon?: ReactNode;
  /** What it opens: a sheet (the default), or a list beside it. */
  opens?: "dialog" | "listbox";
  /** Shown open, while what it opened is open. */
  open?: boolean;
}) {
  const withIcon = props.icon !== undefined;
  return (
    <button
      type="button"
      aria-haspopup={props.opens ?? "dialog"}
      {...(props.open === undefined ? {} : { "aria-expanded": props.open })}
      onClick={props.onClick}
      className={classes(
        PILL_SHAPE,
        props.open ? "bg-accent font-semibold text-primary-text" : PILL_QUIET,
        // The Skill pill keeps its size; a chip naming a long choice gives way and truncates.
        withIcon ? "shrink-0 pr-3 pl-2.5" : "pr-2.5 pl-3",
        "inline-flex max-w-full min-w-0 items-center gap-1.5 self-start hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
        props.wideOnly && "max-md:hidden",
      )}
    >
      {withIcon && (
        <span aria-hidden className="contents">
          {props.icon}
        </span>
      )}
      <span className="truncate">{props.children}</span>
      {!withIcon && <ChevronUp aria-hidden />}
    </button>
  );
}
