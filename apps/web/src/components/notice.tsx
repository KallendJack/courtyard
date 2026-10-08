import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * Something that went wrong or is about to, said plainly, with an optional way to act on it:
 * one action beside it (Retry), or a row of them underneath (a confirm step's buttons).
 */
export function Notice(props: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  /**
   * A region named by its title rather than an alert, for a box the owner opened themselves (a
   * confirm step), which shouldn't be announced as if something had gone wrong.
   */
  region?: boolean;
}) {
  const box =
    "flex items-start justify-between gap-x-4 gap-y-3 rounded-md bg-destructive-soft px-3.5 py-3 text-sm/[21px] text-destructive-text max-md:flex-col";
  const content = (
    <>
      <div>
        {props.title && <p className="font-semibold text-destructive">{props.title}</p>}
        <div>{props.children}</div>
        {props.footer && <div className="mt-3 space-y-2">{props.footer}</div>}
      </div>
      {props.action}
    </>
  );
  return !props.region ? (
    <div role="alert" className={box}>
      {content}
    </div>
  ) : (
    <section aria-label={props.title} className={box}>
      {content}
    </section>
  );
}

/**
 * Something worth knowing on a page, quieter than a `Notice`: a new version, a backup that's
 * behind. Named by `label`, and read out when it changes.
 */
export function InfoBox(props: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={props.label}
      aria-live="polite"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent px-4 py-3 text-sm text-accent-foreground"
    >
      {props.children}
    </section>
  );
}

/** Something to know about that's being handled (the worker reconnecting, say). */
export function StatusPill(props: {
  children: ReactNode;
  /** A small button at the pill's end that deals with what it says. */
  action?: ReactNode;
}) {
  return (
    <div
      className={classes(
        "flex w-fit items-center gap-x-3 gap-y-2 rounded-2xl bg-accent text-sm font-medium text-accent-foreground max-md:flex-wrap",
        props.action === undefined ? "px-3.5 py-1.5" : "py-1.5 pr-1.5 pl-3.5",
      )}
    >
      <p role="status" className="flex min-w-0 items-center gap-2">
        <WaitingDot />
        {props.children}
      </p>
      {props.action}
    </div>
  );
}

/** What a page shows when there's nothing to list yet. */
export function EmptyState(props: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed px-4 py-6 text-muted-foreground">
      {props.children}
    </div>
  );
}

/** The dot beside something being waited on: the worker reconnecting, a sign-in to finish. */
export function WaitingDot() {
  return <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />;
}
