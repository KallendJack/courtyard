import type { BuildStep } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check } from "lucide-react";

/**
 * What a step uses, under its title (#778; Paper, 3 · Drafts, "Draft · Fabrication · A step's
 * uses strip · Fold 933×645 (#778)"): the pieces by letter and count, then its fixings, so they're
 * laid out first; ticked off once the step's done. A fixing's count goes after it, "5 × 80 screws
 * (16)": before a size it would read as one more size. At the bench (`bench`), read at arm's length.
 */
export function UsesStrip(props: { step: BuildStep; done: boolean; bench?: boolean }) {
  const { parts, fixings } = props.step.uses;
  if (parts.length + fixings.length === 0) return null;
  const chips = [
    ...parts.map((part) => `${part.label} × ${part.count}`),
    ...fixings.map((fixing) => `${fixing.name} (${fixing.count})`),
  ];
  return (
    <section
      aria-label="Uses"
      className="flex flex-wrap items-center gap-2 rounded-row bg-muted px-3 py-2.5"
    >
      <CapsLabel tone="muted" inline className="mr-1">
        {props.done ? "Used" : "Uses"}
      </CapsLabel>
      {chips.map((chip) => (
        <span
          key={chip}
          className={classes(
            "flex items-center gap-1.5 rounded-full px-3 py-1 font-mono font-semibold",
            props.bench === true ? "text-interface" : "text-meta",
            props.done ? "bg-success/15 text-success" : "bg-background text-foreground",
          )}
        >
          {props.done && <Check aria-hidden className="size-3.5" />}
          {chip}
        </span>
      ))}
    </section>
  );
}
