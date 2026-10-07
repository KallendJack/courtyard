import { ChevronUp } from "lucide-react";
import { classes } from "@/lib/classes";

/**
 * A small quiet pill saying what's chosen, which opens a sheet to change it (the model above a
 * phone's message box). Its text is its name. Safe on the first load (ADR 0012).
 */
export function Chip(props: {
  children: string;
  onClick: () => void;
  /** Only on a narrow screen: from tablet width up the choice sits elsewhere. */
  narrowOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={props.onClick}
      disabled={props.disabled}
      className={classes(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 self-start rounded-full bg-background py-1.5 pr-2.5 pl-3 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        props.narrowOnly && "md:hidden",
      )}
    >
      <span className="truncate">{props.children}</span>
      <ChevronUp aria-hidden className="size-3.5 shrink-0" />
    </button>
  );
}
