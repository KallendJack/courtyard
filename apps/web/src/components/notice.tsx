import type { ReactNode } from "react";

/** Something that went wrong, said plainly, with an optional way to act on it. */
export function Notice(props: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-4 rounded-md bg-destructive-soft px-3.5 py-3 text-sm/[21px] text-destructive-text"
    >
      <div>
        {props.title && <p className="font-semibold text-destructive">{props.title}</p>}
        <div>{props.children}</div>
      </div>
      {props.action}
    </div>
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
