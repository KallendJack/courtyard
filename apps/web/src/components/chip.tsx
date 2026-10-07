import { ChevronUp } from "lucide-react";
import { classes } from "@/lib/classes";
import { PILL } from "./select.tsx";

/**
 * A small quiet pill saying what's chosen, which opens a sheet to change it (the model above a
 * phone's message box): the same pill as the pickers it stands in for. Its text is its name.
 * Safe on the first load (ADR 0012).
 */
export function Chip(props: {
  children: string;
  onClick: () => void;
  /** Only on a narrow screen: from tablet width up the choice sits elsewhere. */
  narrowOnly?: boolean;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={props.onClick}
      className={classes(
        PILL,
        "inline-flex max-w-full min-w-0 items-center gap-1.5 self-start pr-2.5 hover:text-foreground",
        props.narrowOnly && "md:hidden",
      )}
    >
      <span className="truncate">{props.children}</span>
      <ChevronUp aria-hidden className="size-3.5 shrink-0" />
    </button>
  );
}
