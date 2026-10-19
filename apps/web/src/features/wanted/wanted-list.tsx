import {
  type WantedList as List,
  type PickKind,
  poundsOf,
  type ThingSlug,
  type WantedPick,
  type WantedRow,
  type WorkspaceId,
} from "@courtyard/contract";
import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/buttons/button";
import { WebButton } from "@/components/buttons/web-link";
import { FormError } from "@/components/forms/form-error";
import { CapsLabel } from "@/components/layout/caps-label";
import { createKept, PlaceholderRows, useKept } from "@/components/layout/kept";
import { CARD, SectionTitle } from "@/components/layout/page";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { daysAgoWords } from "@/lib/when";
import { describeProblem } from "../../components/layout/problems.tsx";
import { findPicks, loadWanted } from "./api.ts";

/** Each workspace's wanted list, as last known, so it shows at once on a revisit. */
const KEPT = createKept<List>();

/** How often the list asks again while picks are being found or prices checked. */
const BUSY_EVERY_MS = 3000;

/** What each pick is, as the owner reads it (#245). */
const PICK_WORDS: Readonly<Record<PickKind, string>> = {
  "best-value": "★ Best value",
  cheapest: "Cheapest that does the job",
  stretch: "Worth stretching for",
};

const STATUS_WORDS: Readonly<Record<WantedRow["status"], string>> = {
  want: "To get",
  replace: "Replace",
};

/** The oldest of some picks' checks, as "today" or "6 days ago". */
const checkedWords = (picks: readonly WantedPick[]) => {
  const oldest = picks.reduce<string | undefined>(
    (old, { checkedAt }) => (old === undefined || checkedAt < old ? checkedAt : old),
    undefined,
  );
  return oldest === undefined ? undefined : daysAgoWords(oldest);
};

/** A sale, only ever inside a pick's own line (#245): never a nag of its own. */
const saleWords = (pick: WantedPick, said: "usually" | "was") =>
  pick.usualPence === undefined ? undefined : `in the sale, ${said} ${poundsOf(pick.usualPence)}`;

/** One pick: what it is and why, its price and how fresh it is, and its shop's one button. */
function PickLine(props: { pick: WantedPick; checking: boolean }) {
  const { pick, checking } = props;
  const best = pick.kind === "best-value";
  const why = [pick.why, saleWords(pick, "was"), pick.size].filter((said) => said !== undefined);
  return (
    <li
      aria-label={`${PICK_WORDS[pick.kind]}: ${pick.product}`}
      className={classes(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-row border px-3 py-2.5 md:flex md:h-12.5 md:py-0 md:pr-2",
        best ? "border-primary/35 bg-primary/8" : "border-transparent max-md:border-border",
      )}
    >
      <CapsLabel
        tone={best ? "primary" : "muted"}
        inline
        className="col-span-2 md:w-31 md:shrink-0"
      >
        {PICK_WORDS[pick.kind]}
      </CapsLabel>
      <span className="flex min-w-0 flex-col gap-0.5 md:grow">
        <span
          className={classes(
            "truncate text-sm font-semibold",
            best ? "text-foreground" : "text-foreground/80",
          )}
        >
          {pick.product}
        </span>
        <span className="truncate text-label font-medium text-muted-foreground">
          {why.join(" · ")}
        </span>
      </span>
      <span
        className={classes(
          "flex flex-col items-end gap-px md:w-14 md:shrink-0",
          checking && "opacity-60",
        )}
      >
        <span
          className={classes(
            "text-interface font-bold",
            best ? "text-foreground" : "text-foreground/80",
          )}
        >
          {poundsOf(pick.pence)}
        </span>
        <span className="text-caption font-medium text-muted-foreground">
          {checking ? "checking…" : daysAgoWords(pick.checkedAt)}
        </span>
      </span>
      <span className="col-start-2 flex justify-end md:w-28 md:shrink-0">
        <WebButton href={pick.url} variant={best ? "primary" : "outline"} size="sm">
          {pick.shop}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </WebButton>
      </span>
    </li>
  );
}

/**
 * A Thing on the wanted list: its number, name and status, its ★ pick's price and shop's one
 * button, or Find picks while it has none. Tapping it shows all its picks; on the cover screen
 * they take the list's place, with the way back above them.
 */
function WantedItem(props: {
  row: WantedRow;
  number: number;
  open: boolean;
  /** Another Thing's picks are open, which on the cover screen take this one's place. */
  hidden: boolean;
  checking: boolean;
  onToggle: () => void;
  find: { busy: boolean; run: () => void };
}) {
  const { row, number, open, checking } = props;
  const [best] = row.picks;
  const line = [
    STATUS_WORDS[row.status],
    ...(best === undefined ? [] : [saleWords(best, "usually")]),
    ...(best !== undefined ? [] : [row.finding ? "finding picks…" : "no picks yet"]),
  ].filter((said) => said !== undefined);
  const checked = checkedWords(row.picks);
  return (
    <li
      className={classes(
        "border-b border-secondary last:border-b-0",
        props.hidden && "max-md:hidden",
        open && "pb-2",
      )}
    >
      <div className="flex min-h-14 items-center gap-3 pr-1 pl-2">
        <button
          type="button"
          aria-expanded={open}
          disabled={best === undefined}
          onClick={props.onToggle}
          className="flex min-w-0 grow items-center gap-3 rounded-md py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
        >
          {open && (
            <ChevronLeft aria-hidden className="size-4 shrink-0 text-placeholder md:hidden" />
          )}
          <span className="w-5 shrink-0 text-meta font-semibold text-placeholder max-md:hidden">
            {number}
          </span>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="truncate text-answer/5 font-bold text-foreground">{row.name}</span>
            {!open && (
              <span className="truncate text-meta font-medium text-muted-foreground">
                {line.join(" · ")}
              </span>
            )}
          </span>
          {open ? (
            <span className="shrink-0 text-label font-medium text-muted-foreground">
              {row.picks.length} {row.picks.length === 1 ? "pick" : "picks"}
              {checked === undefined ? "" : ` · prices checked ${checking ? "…" : checked}`}
            </span>
          ) : (
            <span
              className={classes(
                "shrink-0 text-right text-answer/5 font-bold md:w-20",
                best === undefined ? "text-placeholder max-md:hidden" : "text-foreground",
                checking && "opacity-60",
              )}
            >
              {best === undefined ? "—" : `★ ${poundsOf(best.pence)}`}
            </span>
          )}
        </button>
        {!open && (
          <span className="flex shrink-0 justify-end md:w-28">
            {best === undefined ? (
              <Button
                variant="outline"
                size="sm"
                busy={row.finding || props.find.busy}
                busyLabel="Finding…"
                onClick={props.find.run}
              >
                Find picks
              </Button>
            ) : (
              <WebButton href={best.url} variant="outline" size="sm">
                {best.shop}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </WebButton>
            )}
          </span>
        )}
      </div>
      {open && (
        <ul
          aria-label={`Picks for ${row.name}`}
          className="flex flex-col gap-1.5 md:ml-8 md:gap-0.5"
        >
          {row.picks.map((pick) => (
            <PickLine key={pick.kind} pick={pick} checking={checking} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The wanted list (#245; Paper, "Tablet · Wanted: one item's three picks" and its Cover): a
 * planning workspace's Things wanted or to replace, each with its ★ pick's price and its shop's
 * one button, or Find picks. Tapping one shows its three picks, each with why, its price, how fresh
 * that is and its shop. Opening it checks prices over a week old again, quietly; meanwhile they
 * show faintly, "checking…". A sale shows only inside a pick's line, and nothing nags. A general
 * block: any planning workspace with something wanted shows it.
 */
export function WantedList(props: { workspaceId: WorkspaceId }) {
  const { workspaceId } = props;
  const [open, setOpen] = useState<ThingSlug>();
  const list = useKept(KEPT, {
    key: workspaceId,
    load: async () => {
      const loaded = await loadWanted(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    busy: (known) =>
      known.checking || known.rows.some((row) => row.finding) ? BUSY_EVERY_MS : undefined,
  });
  const find = useAction(async (slug: ThingSlug) => {
    const found = await findPicks(workspaceId, slug);
    if (found.kind !== "loaded") return describeProblem(found).body;
    KEPT.set(workspaceId, found.data);
    return undefined;
  });

  if (list === undefined) {
    return (
      <section aria-label="Wanted" className={CARD}>
        <SectionTitle>Wanted</SectionTitle>
        <div className="pt-3">
          <PlaceholderRows count={2} />
        </div>
      </section>
    );
  }
  if (list.rows.length === 0) return null;
  const opened = list.rows.find((row) => row.thing === open && row.picks.length > 0);
  const bests = list.rows.flatMap((row) => row.picks.slice(0, 1));
  const total = bests.reduce((sum, pick) => sum + pick.pence, 0);
  const checked = checkedWords(bests);
  const summary = [
    ...(bests.length === 0 ? [] : [`★ picks so far · ${poundsOf(total)}`]),
    ...(list.checking ? ["checking prices…"] : checked === undefined ? [] : [`checked ${checked}`]),
  ];

  return (
    <section aria-label="Wanted" className={CARD}>
      <div
        className={classes(
          "flex items-center justify-between gap-3 pb-1.5",
          opened !== undefined && "max-md:hidden",
        )}
      >
        <SectionTitle>Wanted · {list.rows.length}</SectionTitle>
        {summary.length > 0 && (
          <p className="text-meta font-medium text-muted-foreground max-md:hidden">
            {summary.join(" · ")}
          </p>
        )}
      </div>
      <ul aria-label="Wanted">
        {list.rows.map((row, index) => (
          <WantedItem
            key={row.thing}
            row={row}
            number={index + 1}
            open={opened?.thing === row.thing}
            hidden={opened !== undefined && opened.thing !== row.thing}
            checking={list.checking}
            onToggle={() => setOpen((was) => (was === row.thing ? undefined : row.thing))}
            find={{
              busy: find.running?.[0] === row.thing,
              run: () => void find.run(row.thing),
            }}
          />
        ))}
      </ul>
      <FormError message={find.error} />
      {opened === undefined && bests.length > 0 && (
        // On the cover screen the summary moves down here, under the list.
        <p className="pt-2 text-label text-muted-foreground md:pl-2">
          <span className="md:hidden">{summary.join(" · ")}. </span>
          Tap an item for its three picks
        </p>
      )}
    </section>
  );
}
