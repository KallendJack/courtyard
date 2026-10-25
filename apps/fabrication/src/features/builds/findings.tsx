import type { BuildFinding, DerivedBuild } from "@courtyard/contract";
import { checkCards } from "./words.ts";

/** Where the findings are, so the top bar's "to check" can take the owner there. */
export const FINDINGS_ID = "build-findings";

/**
 * What the making rules found that needs the owner (ADR 0036; the board's gold card): above the
 * panel's tab, a fixing too short, a tool not to hand, a part too big for its stock or the plate,
 * and a printed part's sizes assumed (#702, from its `print`); and in a step, what was found
 * about it (#699), labelled as its own.
 */
export function Findings(props: {
  findings: readonly BuildFinding[];
  print?: DerivedBuild["print"];
  label?: string;
}) {
  const found = checkCards(props.findings, props.print ?? null);
  if (found.length === 0) return null;
  const all = props.label === undefined;
  return (
    <ul
      id={all ? FINDINGS_ID : undefined}
      aria-label={props.label ?? "To check"}
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
