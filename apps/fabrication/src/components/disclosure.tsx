import { classes } from "@courtyard/ui/lib/classes.ts";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What opens with a tap and is closed until then, its icon violet and its chevron turning as it
 * opens: a step's Tips (#789), a row with what it holds inside it; or a technique's "How?" tap
 * (#813), a pill that opens what it holds under it.
 */
export function Disclosure(props: {
  icon: ReactNode;
  label: ReactNode;
  look: "row" | "tap";
  children: ReactNode;
}) {
  const row = props.look === "row";
  return (
    <details
      className={classes(
        "group flex flex-col",
        row ? "rounded-row bg-muted text-interface text-foreground" : "gap-2",
      )}
    >
      <summary
        className={classes(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold",
          row ? "px-3.5" : "w-fit rounded-full bg-muted px-4 text-interface text-foreground",
        )}
      >
        {props.icon}
        {props.label}
        <ChevronDown
          aria-hidden
          className={classes("size-4 group-open:rotate-180", row && "ml-auto")}
        />
      </summary>
      {props.children}
    </details>
  );
}
