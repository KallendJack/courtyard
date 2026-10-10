import type { ReactNode } from "react";
import { classes } from "@/lib/classes";
import { CARD } from "./page.tsx";

/** Where a connection stands, as its card says at its top right. */
export type ConnectionState = "connected" | "waiting" | "off";

const STATES = {
  connected: {
    word: "Connected",
    dot: "bg-workspace-moss",
    text: "text-muted-foreground",
  },
  waiting: { word: "Waiting for you", dot: "bg-warning", text: "text-foreground" },
  // No dot: nothing is happening.
  off: { word: "Not connected", dot: undefined, text: "text-muted-foreground" },
} as const;

/**
 * One of the home page's Connections (#99): a provider, or GitHub. Its name, a line about it,
 * where it stands, and what the owner can do; one waiting for the owner is ringed in gold, with
 * what to do inside it.
 */
export function ConnectionCard(props: {
  /** What it's called, as the card's heading: "Codex", "GitHub · octo-owner". */
  name: string;
  /** A line under the name: who's signed in, its repos, or why it can't be used. */
  detail?: ReactNode;
  state: ConnectionState;
  /** Buttons beside it, such as Sign out. */
  actions?: ReactNode;
  /** More under the heading, for one waiting for the owner (a sign-in's code). */
  children?: ReactNode;
}) {
  const { word, dot, text } = STATES[props.state];
  return (
    <li
      aria-label={props.name}
      className={classes(
        CARD,
        "flex flex-col gap-3",
        props.state === "waiting" && "ring-2 ring-warning",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold wrap-anywhere">{props.name}</span>
          {props.detail !== undefined && (
            <span className="text-xs text-muted-foreground wrap-anywhere">{props.detail}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={classes("flex items-center gap-1.5 text-xs font-semibold", text)}>
            {dot !== undefined && (
              <span aria-hidden className={classes("size-2 shrink-0 rounded-full", dot)} />
            )}
            {word}
          </span>
          {props.actions}
        </div>
      </div>
      {props.children}
    </li>
  );
}
