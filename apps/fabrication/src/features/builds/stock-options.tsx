import type { BuildStockChoice, BuildStockOptions } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { ChevronLeft } from "lucide-react";
import { pounds } from "./words.ts";

/** The pick just made, while Undo can take it back. */
export type JustPicked = { readonly stock: string; readonly title: string };

const CHIP = "flex h-5.5 items-center rounded-full px-2 text-caption";

/** What a choice is now: picked, recommended, both, or neither. */
const markOf = (choice: BuildStockChoice) =>
  [choice.picked && "Picked", choice.recommended && (choice.picked ? "recommended" : "Recommended")]
    .filter(Boolean)
    .join(" · ");

function Choice(props: {
  choice: BuildStockChoice;
  pick: () => void;
  busy: boolean;
  waiting: boolean;
}) {
  const { choice } = props;
  const mark = markOf(choice);
  const shop = choice.price?.shop;
  const link = choice.price?.link;
  return (
    <li
      className={classes(
        "flex flex-col gap-1.5 rounded-row border px-3 py-2.5",
        choice.picked ? "border-primary bg-primary/10" : "border-border bg-field",
      )}
    >
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-interface font-bold text-foreground">{choice.title}</span>
        <span className="shrink-0 font-mono text-meta text-foreground">
          {choice.total === undefined ? "No price" : pounds(choice.total)}
        </span>
      </p>
      <p className="text-meta text-foreground">{choice.why}</p>
      <p className="text-label text-muted-foreground">
        {choice.buys}
        {shop !== undefined && " · "}
        {shop !== undefined &&
          (link === undefined ? (
            shop
          ) : (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="text-primary-text hover:underline"
            >
              {shop}
            </a>
          ))}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {mark !== "" && (
          <span
            className={classes(
              CHIP,
              "font-bold",
              choice.picked ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}
          >
            {mark}
          </span>
        )}
        {choice.says.map((said) => (
          <span
            key={said.text}
            className={classes(
              CHIP,
              said.tone === "fine" ? "bg-muted text-success" : "bg-warning/10 text-warning",
            )}
          >
            {said.text}
          </span>
        ))}
        {!choice.picked && (
          <Button
            variant="soft"
            size="xs"
            aria-label={`Pick ${choice.title}`}
            busy={props.busy}
            busyLabel="Picking…"
            waiting={props.waiting}
            onClick={props.pick}
          >
            Pick
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * A timber's or sheet's options (#704; Paper, 2 · Agreed, "Fabrication · Choose materials · Tablet
 * (#704)"), opened from its buy-list or cut-plan row: the recommended first, each with what this
 * Build would buy of it, its cost, a line on why, and chips for what to know. Pick swaps it in
 * every part cut from it, and the pick just made can be undone.
 */
export function StockOptionsPanel(props: {
  options: BuildStockOptions;
  back: () => void;
  pick: (choice: BuildStockChoice) => void;
  /** The option being picked, while it is. */
  picking: string | undefined;
  justPicked: JustPicked | undefined;
  undo: () => void;
  undoing: boolean;
  error: string | undefined;
}) {
  const { options } = props;
  const picked = options.choices.find((choice) => choice.picked);
  const busy = props.picking !== undefined || props.undoing;
  return (
    <section aria-label={`${options.name} options`} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={props.back}
          className="flex items-center gap-0.5 self-start text-meta font-medium text-primary-text hover:underline"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Buy list
        </button>
        <h2 className="display-title text-sheet-title">{options.name}</h2>
        <p className="text-label text-muted-foreground">
          {options.for}
          {picked === undefined || picked.buys === "" ? "" : ` · ${picked.buys}`}
        </p>
      </div>
      {props.justPicked !== undefined && (
        <p className="flex items-center justify-between gap-3 rounded-row bg-muted px-3 py-1.5 text-meta text-foreground">
          <span>Picked {props.justPicked.title}</span>
          <Button
            variant="quiet"
            size="xs"
            busy={props.undoing}
            busyLabel="Undoing…"
            waiting={props.picking !== undefined}
            onClick={props.undo}
          >
            Undo
          </Button>
        </p>
      )}
      {props.error !== undefined && (
        <p role="alert" className="text-meta text-destructive-text">
          {props.error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {options.choices.map((choice) => (
          <Choice
            key={choice.option}
            choice={choice}
            pick={() => props.pick(choice)}
            busy={props.picking === choice.option}
            waiting={busy && props.picking !== choice.option}
          />
        ))}
      </ul>
      <p className="text-caption text-muted-foreground">
        Prices are from each shop's page, through the chat · picking one works out the cut plan and
        buy list again
      </p>
    </section>
  );
}
