import type { BuildBuyLine, DerivedBuild } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { ChevronRight } from "lucide-react";
import { pounds } from "./words.ts";

/** How many to buy: "× 5" of what's sold one at a time, "1 pack" of what's sold in packs. */
const howMany = (line: BuildBuyLine) =>
  line.packOf === 1 ? `× ${line.packs}` : `${line.packs} ${line.packs === 1 ? "pack" : "packs"}`;

/** Its second line: the shop, then what it's for. */
const shopAndFor = (line: BuildBuyLine) =>
  [line.price?.shop, line.for].filter((part) => part !== undefined).join(" · ");

function Line(props: { line: BuildBuyLine }) {
  const { line } = props;
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
  const row = "flex items-center gap-3 border-b border-border py-2.5";
  const link = line.price?.link;
  return link === undefined ? (
    <li className={row}>
      {body}
      <span aria-hidden className="w-4 shrink-0" />
    </li>
  ) : (
    <li>
      <a href={link} target="_blank" rel="noreferrer" className={`${row} hover:bg-muted/40`}>
        {body}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </a>
    </li>
  );
}

/**
 * The buy list (#698; Paper, "Fabrication · A Build, buy list · Cover (#698)"): what to buy, from
 * where, how many, and what it comes to, each line a link to its shop where there is one. Its
 * total, and what has no price yet, at its foot.
 */
export function BuyList(props: { buyList: DerivedBuild["buyList"] }) {
  const { lines, total, unpriced } = props.buyList;
  return (
    <section aria-label="Buy list" className="flex flex-col gap-1">
      <CapsLabel tone="muted">To buy · {lines.length}</CapsLabel>
      <ul className="flex flex-col">
        {lines.map((line) => (
          <Line key={line.item} line={line} />
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
