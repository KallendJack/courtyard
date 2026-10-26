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
  const value = line.records.map(recordValue).join(" / ");
  const [record] = line.records;
  const content = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={classes("text-interface", props.next ? "font-bold" : "font-medium")}>
          {line.property}
        </span>
        <span className={classes("text-meta", TONES[state.tone])}>{state.words}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {value !== "" && (
          <span
            className={classes(
              "font-mono text-interface",
              record?.source.kind === "measured" && line.records.length === 1
                ? "font-bold text-foreground"
                : "text-muted-foreground",
            )}
          >
            {value}
          </span>
        )}
        {line.was !== null && (
          <span className="text-meta text-muted-foreground">
            was {line.was.source === "reported" ? "about " : `${sourceWord(line.was.source)} `}
            {valueWords(line.was.value)}
          </span>
        )}
      </span>
    </>
  );
  const look = classes(
    "flex w-full items-center justify-between gap-4 rounded-row px-3 py-2.5 text-left",
    props.next && "bg-primary/12",
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
    <section aria-label={`${thing.name} sizes`} className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5 px-1">
        <Heading className="display-title truncate text-sheet-title">{thing.name}</Heading>
        <Chip tone="quiet">{KINDS[thing.kind]}</Chip>
        <span className="flex-1" />
        {props.add !== undefined && (
          <Button variant="quietPrimary" size="xs" onClick={props.add}>
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
