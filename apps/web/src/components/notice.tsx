import type { ReactNode } from "react";

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
    "flex items-start justify-between gap-4 rounded-md bg-destructive-soft px-3.5 py-3 text-sm/[21px] text-destructive-text";
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
export function StatusPill(props: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="flex w-fit items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-foreground"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
      {props.children}
    </p>
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
