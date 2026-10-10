import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * A card's small label in capitals, above what it labels (Handheld): "Needs your OK", "3 files",
 * "Notifications". Gold when it's something that needs the owner, muted otherwise. A heading when
 * it names its card, with the `id` the card is labelled by.
 */
export function CapsLabel(props: {
  tone: "warning" | "muted";
  heading?: { readonly id: string };
  /** Space around it inside a list, such as the file tree's. */
  inList?: boolean;
  children: ReactNode;
}) {
  const className = classes(
    "text-[11px]/4 font-bold tracking-[0.08em] uppercase",
    props.tone === "warning" ? "text-warning" : "text-muted-foreground",
    props.inList && "px-2.5 pt-1.5 pb-1",
  );
  return props.heading === undefined ? (
    <p className={className}>{props.children}</p>
  ) : (
    <h3 id={props.heading.id} className={className}>
      {props.children}
    </h3>
  );
}
