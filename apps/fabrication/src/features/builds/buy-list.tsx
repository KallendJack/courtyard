import type { BuildBuyLine, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { pounds, tenths } from "./words.ts";

/** How many to buy: "× 5" of what's sold one at a time, "1 pack" of what's sold in packs. */
const howMany = (line: BuildBuyLine) =>
  line.packOf === 1 ? `× ${line.packs}` : `${line.packs} ${line.packs === 1 ? "pack" : "packs"}`;

/** Its second line: the shop, then what it's for. */
const shopAndFor = (line: BuildBuyLine) =>
  [line.price?.shop, line.for].filter((part) => part !== undefined).join(" · ");

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

function Line(props: { line: BuildBuyLine; open: (() => void) | undefined }) {
  const { line, open } = props;
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-interface font-bold text-foreground">{line.item}</span>
        <span className="truncate text-meta text-muted-foreground">{shopAndFor(line)}</span>
      </span>
      <span className="shrink-0 font-mono text-meta text-muted-foreground">{howMany(line)}</span>
      <span className="w-17 shrink-0 text-right font-mono text-meta font-bold text-foreground">
        {line.total === undefined ? "No price" : pounds(line.total)}
      </span>
    </>
  );
  const row = "flex items-center gap-3 py-2.5";
  const link = line.price?.link;
  return (
    <li className="border-b border-border">
      {open !== undefined ? (
        // A timber or sheet with options opens them (#704); its shop's link is there.
        <button
          type="button"
          onClick={open}
          className={`${row} w-full text-left hover:bg-muted/40`}
        >
          {body}
          <ChevronRight aria-hidden className="size-4 shrink-0 text-primary-text" />
        </button>
      ) : link === undefined ? (
        <div className={row}>
          {body}
          <span aria-hidden className="w-4 shrink-0" />
        </div>
      ) : (
        <a href={link} target="_blank" rel="noreferrer" className={`${row} hover:bg-muted/40`}>
          {body}
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </a>
      )}
      {/* A bolt's length sits under its row. */}
      {line.length && <BoltLength line={line} length={line.length} />}
    </li>
  );
}

/**
 * The buy list (#698; Paper, "Fabrication · A Build, buy list · Cover (#698)"): what to buy, from
 * where, how many, and what it comes to, each line a link to its shop where there is one, or
 * opening its options where it's a timber or sheet with some (#704). Its total, and what has no
 * price yet, at its foot.
 */
export function BuyList(props: {
  buyList: DerivedBuild["buyList"];
  /** The stocks with options to pick from, by name. */
  withOptions: readonly string[];
  openOptions: (stock: string) => void;
}) {
  const { lines, total, unpriced } = props.buyList;
  return (
    <section aria-label="Buy list" className="flex flex-col gap-1">
      <CapsLabel tone="muted">To buy · {lines.length}</CapsLabel>
      <ul className="flex flex-col">
        {lines.map((line) => (
          <Line
            key={line.item}
            line={line}
            open={
              line.stock !== undefined && props.withOptions.includes(line.stock)
                ? () => props.openOptions(line.stock ?? "")
                : undefined
            }
          />
        ))}
      </ul>
      <p className="flex items-baseline justify-between gap-3 pt-3">
        <span className="text-meta text-muted-foreground">
          {unpriced === 0 ? "Everything priced" : `${unpriced} without a price yet`}
        </span>
        <span className="font-mono text-xl font-bold text-foreground">
          <span className="sr-only">Total </span>
          {pounds(total)}
        </span>
      </p>
    </section>
  );
}
