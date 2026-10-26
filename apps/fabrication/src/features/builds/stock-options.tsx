import type {
  BuildSlug,
  BuildStockChoice,
  BuildStockOptions,
  ChangeId,
  DerivedBuild,
  WorkspaceId,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { Chip } from "@courtyard/ui/buttons/chip.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { type Answer, pickStock, undoBuildChange } from "../../api/fabrication.ts";
import { UndoNote } from "../../components/undo-note.tsx";
import { pounds } from "./words.ts";

/** The pick just made, while Undo can take it back. */
export type JustPicked = { readonly stock: string; readonly title: string };

/** A choice that can be picked: one of the options, not stock that's no option. */
export type Pickable = BuildStockChoice & { readonly option: string };

/** What a choice is now: picked, recommended, both, or neither. */
const markOf = (choice: BuildStockChoice) =>
  [choice.picked && "Picked", choice.recommended && (choice.picked ? "recommended" : "Recommended")]
    .filter(Boolean)
    .join(" · ");

/** Where a choice's price is from: its shop, linked to its page, or that no shop was given. */
function Shop(props: { price: BuildStockChoice["price"] }) {
  const { price } = props;
  if (price === undefined) return null;
  if (price.shop === undefined) return " · no shop given";
  return (
    <>
      {" · "}
      {price.link === undefined ? (
        price.shop
      ) : (
        <a
          href={price.link}
          target="_blank"
          rel="noreferrer"
          className="text-primary-text hover:underline"
        >
          {price.shop}
        </a>
      )}
    </>
  );
}

function Choice(props: {
  choice: BuildStockChoice;
  pick: (choice: Pickable) => void;
  busy: boolean;
  waiting: boolean;
}) {
  const { choice } = props;
  const { option } = choice;
  const mark = markOf(choice);
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
        <Shop price={choice.price} />
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {mark !== "" && (
          <Chip tone={choice.picked ? "chosen" : "plain"} size="sm" strong>
            {mark}
          </Chip>
        )}
        {choice.says.map((said) => (
          <Chip key={said.text} tone={said.tone === "fine" ? "fine" : "needs"} size="sm">
            {said.text}
          </Chip>
        ))}
        {!choice.picked && option !== undefined && (
          <Button
            variant="soft"
            size="xs"
            aria-label={`Pick ${choice.title}`}
            busy={props.busy}
            busyLabel="Picking…"
            waiting={props.waiting}
            onClick={() => props.pick({ ...choice, option })}
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
 * (#704)"), opened from its buy-list or cut-plan row, and back to it: the recommended first, each
 * with what this Build would buy of it, its cost, a line on why, and chips for what to know. Pick
 * swaps it in every part cut from it, and the pick just made can be undone.
 */
export function StockOptionsPanel(props: {
  options: BuildStockOptions;
  /** The tab it was opened from, which back goes to: "Buy list" or "Cut plan". */
  backTo: string;
  back: () => void;
  pick: (choice: Pickable) => void;
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
          {props.backTo}
        </button>
        <h2 className="display-title text-sheet-title">{options.name}</h2>
        <p className="text-label text-muted-foreground">
          {options.for}
          {picked === undefined || picked.buys === "" ? "" : ` · ${picked.buys}`}
        </p>
      </div>
      {props.justPicked !== undefined && (
        <UndoNote undo={props.undo} undoing={props.undoing} waiting={props.picking !== undefined}>
          Picked {props.justPicked.title}
        </UndoNote>
      )}
      <FormError message={props.error} />
      <ul className="flex flex-col gap-2">
        {options.choices.map((choice) => (
          <Choice
            key={choice.option ?? choice.stock}
            choice={choice}
            pick={props.pick}
            busy={choice.option !== undefined && props.picking === choice.option}
            waiting={busy && (choice.option === undefined || props.picking !== choice.option)}
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

/** Why a pick or its Undo didn't happen, as the options say it. */
const problemOf = (answer: Exclude<Answer<unknown>, { kind: "loaded" }>) =>
  answer.kind === "failed" ? answer.message : "Can't reach Courtyard's worker. Try again.";

/**
 * A Build's stock options on its page (#704): the stock whose options are open, in the side panel
 * in place of its tab, and the pick just made, with its Undo. `reread` reads the Build again once
 * a pick or an Undo has changed it.
 */
export const useStockOptions = (props: {
  where: { workspaceId: WorkspaceId; slug: BuildSlug };
  derived: DerivedBuild;
  reread: () => Promise<void>;
}) => {
  const { where, reread } = props;
  const [choosing, setChoosing] = useState<string>();
  const [justPicked, setJustPicked] = useState<
    JustPicked & { readonly change: ChangeId; readonly before: string }
  >();
  const picking = useAction(async (stock: string, choice: Pickable) => {
    const done = await pickStock(where, { stock, option: choice.option });
    if (done.kind !== "loaded") return problemOf(done);
    const { change } = done.data;
    setJustPicked(
      change === null
        ? undefined
        : { stock: choice.stock, title: choice.title, change, before: stock },
    );
    setChoosing(choice.stock);
    await reread();
    return undefined;
  });
  const undoing = useAction(async () => {
    if (justPicked === undefined) return undefined;
    const done = await undoBuildChange(where, justPicked.change);
    if (done.kind !== "loaded") return problemOf(done);
    setChoosing(justPicked.before);
    setJustPicked(undefined);
    await reread();
    return undefined;
  });
  const options = props.derived.options.find((each) => each.stock === choosing);
  const close = () => setChoosing(undefined);
  return {
    open: (stock: string) => {
      picking.setError(undefined);
      undoing.setError(undefined);
      setChoosing(stock);
    },
    close,
    /** Whether a stock's options are open. */
    showing: options !== undefined,
    /** The options open, back to the tab `backTo`; or nothing while none are. */
    panel: (backTo: string) =>
      options === undefined ? null : (
        <StockOptionsPanel
          options={options}
          backTo={backTo}
          back={close}
          pick={(choice) => void picking.run(options.stock, choice)}
          picking={picking.running?.[1].option}
          justPicked={justPicked?.stock === options.stock ? justPicked : undefined}
          undo={() => void undoing.run()}
          undoing={undoing.busy}
          error={picking.error ?? undoing.error}
        />
      ),
  };
};
