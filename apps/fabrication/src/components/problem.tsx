import type { ReactNode } from "react";

/** A page that can't show what it's for: one quiet line, and the way back to Courtyard. */
export function Problem(props: { children: ReactNode }) {
  return (
    <main className="mx-auto flex h-full max-w-reading flex-col justify-center gap-3 px-5">
      <p className="text-interface text-foreground/90">{props.children}</p>
      <a href="/" className="text-interface font-semibold text-primary-text">
        Back to Courtyard
      </a>
    </main>
  );
}
