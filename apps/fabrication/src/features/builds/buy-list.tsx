import {
  type BuildBuyLine,
  type ChangeId,
  type DerivedBuild,
  stockKindOf,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { type Answer, haveIt, undoHaveIt } from "../../api/fabrication.ts";
import { listed, pounds, tenths } from "./words.ts";

/** How many to buy: "× 5" of what's sold one at a time, "1 pack" of what's sold in packs. */
const howMany = (line: BuildBuyLine) =>
  line.packOf === 1 ? `× ${line.packs}` : `${line.packs} ${line.packs === 1 ? "pack" : "packs"}`;

/** Its second line: what Your stock has of it, the shop and its price, then what it's for. */
const detailOf = (line: BuildBuyLine) =>
  [
    line.have === undefined ? undefined : `You have ${line.have}`,
    [line.price?.shop, line.total === undefined ? "no price" : pounds(line.total)]
      .filter((part) => part !== undefined)
      .join(" "),
    line.for,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

/** A line's group on the list, as the board heads them. */
const GROUPS: Record<BuildBuyLine["kind"], string> = {
  timber: "Timber",
  sheet: "Sheets",
  fitted: "Fixings",
  fixing: "Fixings",
  filament: "Filament",
  tool: "Tools",
};

/** The lines in their groups, each group where its first line is. */
const grouped = (lines: readonly BuildBuyLine[]) => {
  const groups = new Map<string, BuildBuyLine[]>();
  for (const line of lines) {
    const group = GROUPS[line.kind];
    groups.set(group, [...(groups.get(group) ?? []), line]);
  }
  return [...groups];
};

/** A bolt's length, as the length its line buys: "65" of "M6 × 65 bolts". */
const lengthBought = (line: BuildBuyLine) => /× (\d+)/.exec(line.item)?.[1];

/**
 * A bolt's length worked out (#763), under its line: the owner's own bolts that are too short, in
 * gold, and what it passes through, a tap away for the curious.
 */
function BoltLength(props: { line: BuildBuyLine; length: NonNullable<BuildBuyLine["length"]> }) {
  const { line, length } = props;
  const [open, setOpen] = useState(false);
  const bought = lengthBought(line);
  return (
    <div className="flex flex-col items-start gap-1 pb-2.5">
      {length.yoursShort && (
        <p className="text-meta text-warning">
          Your {length.yoursShort.name}s are {tenths(length.yoursShort.by)} mm short: you need{" "}
          {bought}s.
        </p>
      )}
      <Button
        variant="quietPrimary"
        size="words"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        Why {bought} mm?
      </Button>
      {open && (
        <p className="font-mono text-meta text-muted-foreground">
          {length.through.map(({ what, mm }) => `${what} ${tenths(mm)}`).join(" + ")} ={" "}
          {tenths(length.needed)} mm
        </p>
      )}
    </div>
  );
}

function Line(props: {
  line: BuildBuyLine;
  open: (() => void) | undefined;
  /** Have it, for a line Your stock can keep; none for a tool. */
  have: (() => void) | undefined;
  busy: boolean;
  waiting: boolean;
}) {
  const { line, open } = props;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-interface font-bold text-foreground">{line.item}</span>
        <span className="truncate text-meta text-muted-foreground">{detailOf(line)}</span>
      </span>
      <span className="shrink-0 font-mono text-meta text-muted-foreground">{howMany(line)}</span>
    </>
  );
  const row = "flex min-w-0 flex-1 items-center gap-3 py-2.5";
  const link = line.price?.link;
  return (
    <li className="border-b border-border">
      <div className="flex items-center gap-2">
        {open !== undefined ? (
          // A timber or sheet with options opens them (#704); its shop's link is there.
          <button type="button" onClick={open} className={`${row} text-left hover:bg-muted/40`}>
            {body}
            <ChevronRight aria-hidden className="size-4 shrink-0 text-primary-text" />
          </button>
        ) : link === undefined ? (
          <div className={row}>{body}</div>
        ) : (
          <a href={link} target="_blank" rel="noreferrer" className={`${row} hover:bg-muted/40`}>
            {body}
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </a>
        )}
        {props.have !== undefined && (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Have it: ${line.item}`}
            busy={props.busy}
            busyLabel="Saving…"
            waiting={props.waiting}
            onClick={props.have}
          >
            Have it
          </Button>
        )}
      </div>
      {/* A bolt's length sits under its row. */}
      {line.length && <BoltLength line={line} length={line.length} />}
    </li>
  );
}

/** What Your stock covers whole, folded away: "You have 2 · screws, castors", and Show. */
function Had(props: { had: readonly BuildBuyLine[] }) {
  const [open, setOpen] = useState(false);
  if (props.had.length === 0) return null;
  return (
    <section aria-label="You have" className="flex flex-col gap-1 pt-1">
      <p className="flex items-center gap-2">
        <Check aria-hidden className="size-4 shrink-0 text-success" />
        <span className="min-w-0 flex-1 truncate text-meta text-success">
          You have {props.had.length} · {listed(props.had.map((line) => line.item))}
        </span>
        <Button
          variant="quietPrimary"
          size="words"
          aria-expanded={open}
          onClick={() => setOpen((now) => !now)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </p>
      {open && (
        <ul className="flex flex-col">
          {props.had.map((line) => (
            <li
              key={line.item}
              className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-meta"
            >
              <span className="text-foreground">{line.item}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{line.needed} used</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Why Have it or its Undo didn't happen, as the list says it. */
const problemOf = (answer: Exclude<Answer<unknown>, { kind: "loaded" }>) =>
  answer.kind === "failed" ? answer.message : "Can't reach Courtyard's worker. Try again.";

/**
 * The buy list (#698; with Have it, #760: Paper, 2 · Agreed, "Fabrication · Buy list with Have it ·
 * Fold"): how many things are left to buy and what they come to, then each line in its group, a
 * link to its shop where there is one, or opening its options where it's a timber or sheet with
 * some (#704). Have it saves a line to Your stock, for every Build, and it drops off the list, with
 * Undo; what Your stock covers is folded away at the foot.
 */
export function BuyList(props: {
  buyList: DerivedBuild["buyList"];
  /** The stocks with options to pick from, by name. */
  withOptions: readonly string[];
  openOptions: (stock: string) => void;
  /** Reads the Build again, once Have it or its Undo has changed what's left. */
  reread: () => Promise<void>;
}) {
  const { lines, had, total, unpriced } = props.buyList;
  const { reread } = props;
  const [justHad, setJustHad] = useState<{ item: string; change: ChangeId }>();
  const having = useAction(async (line: BuildBuyLine) => {
    const kind = stockKindOf(line.kind);
    if (kind === undefined) return undefined;
    const done = await haveIt({
      name: line.item,
      kind,
      count: line.needed + (line.have ?? 0),
    });
    if (done.kind !== "loaded") return problemOf(done);
    const { change } = done.data;
    setJustHad(change === null ? undefined : { item: line.item, change });
    await reread();
    return undefined;
  });
  const undoing = useAction(async () => {
    if (justHad === undefined) return undefined;
    const done = await undoHaveIt(justHad.change);
    if (done.kind !== "loaded") return problemOf(done);
    setJustHad(undefined);
    await reread();
    return undefined;
  });
  const busy = having.busy || undoing.busy;
  return (
    <section aria-label="Buy list" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="display-title text-sheet-title">
          {lines.length === 0
            ? "Nothing left to buy"
            : `${lines.length} ${lines.length === 1 ? "thing" : "things"} left`}
        </h2>
        <span className="shrink-0 font-mono text-xl font-bold text-foreground">
          <span className="sr-only">Total </span>
          {pounds(total)}
        </span>
      </div>
      <p className="text-meta text-muted-foreground">
        Tick Have it and the line drops off the list
        {unpriced === 0 ? "." : ` · ${unpriced} without a price yet`}
      </p>
      {justHad !== undefined && (
        <p className="flex items-center justify-between gap-3 rounded-row bg-muted px-3 py-1.5 text-meta text-foreground">
          <span className="min-w-0 truncate">Have it: {justHad.item}</span>
          <Button
            variant="quiet"
            size="xs"
            busy={undoing.busy}
            busyLabel="Undoing…"
            waiting={having.busy}
            onClick={() => void undoing.run()}
          >
            Undo
          </Button>
        </p>
      )}
      <FormError message={having.error ?? undoing.error} />
      {grouped(lines).map(([group, inGroup]) => (
        <div key={group} className="flex flex-col pt-2">
          <CapsLabel tone="muted">{group}</CapsLabel>
          <ul className="flex flex-col">
            {inGroup.map((line) => (
              <Line
                key={line.item}
                line={line}
                open={
                  line.stock !== undefined && props.withOptions.includes(line.stock)
                    ? () => props.openOptions(line.stock ?? "")
                    : undefined
                }
                have={
                  stockKindOf(line.kind) === undefined ? undefined : () => void having.run(line)
                }
                busy={having.running?.[0].item === line.item}
                waiting={busy && having.running?.[0].item !== line.item}
              />
            ))}
          </ul>
        </div>
      ))}
      <Had had={had} />
    </section>
  );
}
