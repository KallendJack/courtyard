import type { SizeLine, ThingSizes } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { Chip } from "@courtyard/ui/buttons/chip.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { lineState, recordValue, sourceWord, valueWords } from "./words.ts";

const KINDS = { space: "Space", item: "Item", tool: "Tool" } as const;

const TONES = {
  measured: "text-success",
  needs: "text-warning",
  next: "text-primary-text",
  quiet: "text-muted-foreground",
} as const;

/**
 * One size as the Things panel shows it (#709; Paper, 2 · Agreed, "Fabrication · Sizes in the
 * room's Things panel · Tablet (#709)"): its name, what's happening with it (its source as a word
 * and its day, to measure and where, or two answers), and its value on the right, the answers
 * side by side when they disagree, with what it was before a correction under it. Tapping it
 * corrects it, or settles its answers.
 */
function Line(props: {
  line: SizeLine;
  next: boolean;
  now: number;
  tap: (() => void) | undefined;
}) {
  const { line } = props;
  const state = lineState(line, { next: props.next, now: props.now });
  const [record] = line.records;
  const content = (
    <>
      <span className="flex min-w-0 grow basis-0 flex-col">
        <span className={classes("text-meta text-foreground", props.next && "font-semibold")}>
          {line.property}
        </span>
        <span className={classes("text-caption", TONES[state.tone])}>{state.words}</span>
      </span>
      <span className="flex max-w-3/5 flex-col items-end text-right">
        {line.records.length > 0 && (
          <span
            className={classes(
              // Each answer kept whole: two side by side, or one above the other when narrow.
              "flex flex-wrap justify-end gap-x-1.5 *:whitespace-nowrap",
              record?.value.kind === "quantity" ? "font-mono text-meta" : "text-label",
              record?.source.kind === "measured" && line.records.length === 1
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            {line.records.map((one, index) => (
              <span key={one.id}>
                {index > 0 && " / "}
                {recordValue(one)}
              </span>
            ))}
          </span>
        )}
        {line.was !== null && (
          <span className="text-caption text-muted-foreground">
            was {line.was.source === "reported" ? "about " : `${sourceWord(line.was.source)} `}
            {valueWords(line.was.value)}
          </span>
        )}
      </span>
    </>
  );
  const look = classes(
    "flex min-h-11.5 items-center justify-between gap-2 rounded-md py-1 text-left",
    // The line being measured is lit, its light reaching past its words as the board has it.
    props.next ? "-mx-2 w-[calc(100%+1rem)] bg-primary/8 px-2" : "w-full",
  );
  return (
    <li className="border-b border-border last:border-b-0">
      {props.tap === undefined ? (
        <div className={look}>{content}</div>
      ) : (
        <button type="button" onClick={props.tap} className={classes(look, "hover:bg-muted")}>
          {content}
        </button>
      )}
    </li>
  );
}

/**
 * A Thing's sizes (#709): its name and kind, + Size, and a line for each size. The line the guided
 * re-measure is on is lit. One record everywhere in Fabrication: a Build shows the same lines.
 */
export function ThingSizesBlock(props: {
  sizes: ThingSizes;
  /** The size the guided re-measure is on, by its name. */
  next?: string | undefined;
  now: number;
  tap?: (line: SizeLine) => void;
  add?: () => void;
  /** The heading's level: 2 on a space's page, 3 inside a Build's panel. */
  level?: 2 | 3;
}) {
  const { thing, lines } = props.sizes;
  const Heading = props.level === 3 ? "h3" : "h2";
  return (
    <section aria-label={`${thing.name} sizes`} className="flex flex-col gap-1.5">
      <div className="flex min-h-8 items-center gap-2">
        <Heading className="display-section truncate text-base">{thing.name}</Heading>
        <Chip tone="quiet" size="sm">
          {KINDS[thing.kind]}
        </Chip>
        <span className="grow" />
        {props.add !== undefined && (
          <Button variant="quietPrimary" size="words" onClick={props.add}>
            + Size
          </Button>
        )}
      </div>
      <ul className="flex flex-col">
        {lines.map((line) => (
          <Line
            key={line.property}
            line={line}
            next={line.property === props.next}
            now={props.now}
            tap={props.tap === undefined ? undefined : () => void props.tap?.(line)}
          />
        ))}
      </ul>
    </section>
  );
}
