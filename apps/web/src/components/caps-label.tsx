import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

const TONES = {
  /** Something that needs the owner: "Needs you". */
  warning: "text-warning",
  /** What's live: "Building". */
  primary: "text-primary-text",
  muted: "text-muted-foreground",
} as const;

/**
 * A section's label in capitals, the style guide's `label` (12/16, 600, +8%; #242): "Needs your
 * OK", "Next up", "Notifications", a bar's "Main". The one label in capitals: none is written by
 * hand (scripts/theme/check.ts). Gold when it's something that needs the owner, violet for what's
 * live, muted otherwise. A heading when it names its section, with the `id` the section is
 * labelled by; a line of its own, or the first word in a row of other things (`inline`).
 */
export function CapsLabel(props: {
  tone: keyof typeof TONES;
  heading?: { readonly level?: 2 | 3; readonly id?: string };
  /** In a line of other things, such as a bar's "Main" before its build. */
  inline?: boolean;
  /** Space around it inside a list, such as the file tree's. */
  inList?: boolean;
  /** Where it sits in its line (`shrink-0`, a width, hidden on a phone), never how it looks. */
  className?: string;
  children: ReactNode;
}) {
  const className = classes(
    "text-label font-semibold tracking-label uppercase",
    TONES[props.tone],
    props.inList && "px-2.5 pt-1.5 pb-1",
    props.className,
  );
  const { heading } = props;
  if (heading !== undefined) {
    const Heading = heading.level === 2 ? "h2" : "h3";
    return (
      <Heading id={heading.id} className={className}>
        {props.children}
      </Heading>
    );
  }
  return props.inline ? (
    <span className={className}>{props.children}</span>
  ) : (
    <p className={className}>{props.children}</p>
  );
}
