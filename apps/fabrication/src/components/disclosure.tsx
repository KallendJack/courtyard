import { classes } from "@courtyard/ui/lib/classes.ts";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What opens with a tap and is closed until then, its icon violet and its chevron turning as it
 * opens: a step's Tips (#789), a row with what it holds inside it; a technique's "How?" tap
 * (#813), a pill that opens what it holds under it; or a small violet chip, the parts page's
 * "How?" (#778), with no icon or chevron.
 */
export function Disclosure(props: {
  icon?: ReactNode;
  label: ReactNode;
  look: "row" | "tap" | "chip";
  children: ReactNode;
}) {
  const row = props.look === "row";
  const chip = props.look === "chip";
  return (
    <details
      className={classes(
        "group flex flex-col",
        row ? "rounded-row bg-muted text-interface text-foreground" : "gap-2",
      )}
    >
      <summary
        className={classes(
          "flex cursor-pointer list-none items-center gap-2 font-semibold",
          chip
            ? "h-7.5 w-fit rounded-full border border-input bg-secondary px-3 text-meta text-primary-text"
            : classes(
                "min-h-11",
                row ? "px-3.5" : "w-fit rounded-full bg-muted px-4 text-interface text-foreground",
              ),
        )}
      >
        {props.icon}
        {props.label}
        {!chip && (
          <ChevronDown
            aria-hidden
            className={classes("size-4 group-open:rotate-180", row && "ml-auto")}
          />
        )}
      </summary>
      {props.children}
    </details>
  );
}
