import type { DerivedBuild } from "@courtyard/contract";
import { checkCards } from "./words.ts";

/** Where the findings are, so the top bar's "to check" can take the owner there. */
export const FINDINGS_ID = "build-findings";

/**
 * What the making rules found that needs the owner (ADR 0036; the board's gold card), above the
 * panel's tab: a fixing too short, a tool not to hand, a part too big for its stock or the plate.
 */
export function Findings(props: { derived: Pick<DerivedBuild, "findings" | "print"> }) {
  const found = checkCards(props.derived);
  if (found.length === 0) return null;
  return (
    <ul
      id={FINDINGS_ID}
      aria-label="To check"
      tabIndex={-1}
      className="flex flex-col gap-2 outline-none"
    >
      {found.map(({ title, detail }) => (
        <li
          key={title}
          className="flex flex-col gap-1 rounded-row border border-warning/40 bg-warning/8 px-3.5 py-3"
        >
          <p className="text-interface font-bold text-warning">{title}</p>
          <p className="text-meta text-foreground/90">{detail}</p>
        </li>
      ))}
    </ul>
  );
}
