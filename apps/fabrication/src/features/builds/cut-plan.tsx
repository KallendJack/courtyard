import type { BuildCutPlan, BuildStep, DerivedBuild } from "@courtyard/contract";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { assumedSizes, metres } from "./words.ts";

type Length = BuildCutPlan["timber"][number]["lengths"][number];
/** A length as the marking step marks it (#754). */
type BuildMarkedLength = NonNullable<BuildStep["actions"][number]["length"]>;

/** A part's piece, lit while it's the one tapped (#698), here as in the 3D view and its key. */
const piece = (lit: boolean) =>
  classes(
    "flex min-w-0 items-center justify-center rounded-sm font-mono text-caption font-semibold text-background",
    lit && "ring-stroke ring-primary-text ring-offset-2 ring-offset-surface",
  );

/** Lengths cut the same way, once each, with how many: four lengths of B and A read "× 4". */
const sameCuts = (lengths: readonly Length[]) => {
  const groups: { length: Length; count: number }[] = [];
  for (const length of lengths) {
    const key = length.cuts.map((cut) => `${cut.label}${cut.length}`).join();
    const same = groups.find(
      (group) => group.length.cuts.map((cut) => `${cut.label}${cut.length}`).join() === key,
    );
    if (same === undefined) groups.push({ length, count: 1 });
    else same.count += 1;
  }
  return groups;
};

/** A group's line: what it's cut from and how many, and its stock's options on its first (#704). */
function StockLine(props: { name: string; count: number; options: (() => void) | undefined }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-meta text-foreground">
      <span className="min-w-0 font-semibold">{props.name}</span>
      <span className="flex items-baseline gap-3">
        <span className="font-mono text-muted-foreground">× {props.count}</span>
        {props.options !== undefined && (
          <button
            type="button"
            aria-label={`Options for ${props.name.split(",")[0]}`}
            onClick={props.options}
            className="font-medium text-primary-text hover:underline"
          >
            Options
          </button>
        )}
      </span>
    </p>
  );
}

/** A length as it's marked, in words: "B 1450 · 3 mm saw cut · A 750 · offcut 197". */
const markedWords = (length: BuildMarkedLength) =>
  [
    ...length.cuts.flatMap((cut, at) => [
      ...(at === 0 ? [] : [`${length.kerf} mm saw cut`]),
      `${cut.label} ${cut.length}`,
    ]),
    `offcut ${length.offcut}`,
  ].join(" · ");

/**
 * One length as it's marked (#754), as the cut plan draws it: its pieces end to end from the
 * square end, the saw's cut between each two in red so the gap shows, and the offcut left over.
 */
export function LengthBar(props: { length: BuildMarkedLength }) {
  const { length } = props;
  const share = (mm: number) => `${(mm / length.stockLength) * 100}%`;
  return (
    <div className="flex flex-col gap-1">
      <div
        role="img"
        aria-label={markedWords(length)}
        className="flex h-7 overflow-hidden rounded-sm bg-muted"
      >
        {length.cuts.map((cut, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a length's cuts are only ever in this order
          <div key={at} className="flex min-w-0" style={{ width: share(cut.length) }}>
            {at > 0 && <span className="w-0.5 shrink-0 bg-destructive" />}
            <span className={classes(piece(false), "flex-1 bg-timber")}>
              <span className="truncate px-1">
                {cut.label} {cut.length}
              </span>
            </span>
          </div>
        ))}
      </div>
      {/* The bar's own words, for the eye: a screen reader has them as the bar's name. */}
      <p aria-hidden className="font-mono text-meta text-muted-foreground">
        {markedWords(length)}
      </p>
    </div>
  );
}

/**
 * The cut plan (#698; the board's Cut plan tab): each length of timber as a bar of its cuts, each
 * as long as it is, with the offcut left; and each sheet with its pieces where they sit. Tapping a
 * piece lights its part everywhere and opens its card.
 */
export function CutPlan(props: {
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
  openOptions: (stock: string) => void;
}) {
  const { cutPlan } = props.derived;
  /** A stock's options, on its first line only, where it has some. */
  const optionsOf = (stock: string, first: boolean) =>
    first && props.derived.options.some((options) => options.stock === stock)
      ? () => props.openOptions(stock)
      : undefined;
  const assumed = assumedSizes(props.derived.findings).includes("saw cut");
  const button = (label: string, title: string) => ({
    type: "button" as const,
    "aria-label": title,
    "aria-pressed": props.lit === label,
    onClick: () => props.pick(label),
  });
  return (
    <section aria-label="Cut plan" className="flex flex-col gap-4">
      <p className="text-meta text-muted-foreground">
        Each saw cut takes {cutPlan.kerf} mm{assumed ? " · assumed" : ""}
      </p>
      {cutPlan.timber.flatMap((timber) =>
        sameCuts(timber.lengths).map(({ length, count }, group) => (
          <section
            key={`${timber.stock}:${length.cuts.map((cut) => cut.label).join()}`}
            className="flex flex-col gap-1.5"
          >
            <StockLine
              name={`${timber.stock}, ${metres(timber.stockLength)}`}
              count={count}
              options={optionsOf(timber.stock, group === 0)}
            />
            <div className="flex h-9 gap-px rounded-sm bg-muted">
              {length.cuts.map((cut, at) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: a length's cuts are only ever in this order
                  key={at}
                  {...button(cut.label, `${cut.label}, ${cut.length} mm`)}
                  style={{ width: `${(cut.length / timber.stockLength) * 100}%` }}
                  className={classes(piece(props.lit === cut.label), "bg-timber")}
                >
                  <span className="truncate px-1">
                    {cut.label} {cut.length}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )),
      )}
      {cutPlan.sheets.flatMap((sheet) =>
        sheet.sheets.map((each, at) => (
          <section
            // biome-ignore lint/suspicious/noArrayIndexKey: a stock's sheets are only ever in this order
            key={`${sheet.stock}:${at}`}
            className="flex flex-col gap-1.5"
          >
            <StockLine
              name={`${sheet.stock}, ${sheet.sheetLength} × ${sheet.sheetWidth}`}
              count={1}
              options={optionsOf(sheet.stock, at === 0)}
            />
            <div
              className="relative w-full rounded-sm bg-muted"
              style={{ aspectRatio: `${sheet.sheetLength} / ${sheet.sheetWidth}` }}
            >
              {each.pieces.map((part) => {
                const wide = part.along / sheet.sheetLength > 0.3;
                return (
                  <button
                    key={`${part.label}:${part.x}:${part.y}`}
                    {...button(part.label, `${part.label}, ${part.along} × ${part.across} mm`)}
                    style={{
                      left: `${(part.x / sheet.sheetLength) * 100}%`,
                      top: `${(part.y / sheet.sheetWidth) * 100}%`,
                      width: `${(part.along / sheet.sheetLength) * 100}%`,
                      height: `${(part.across / sheet.sheetWidth) * 100}%`,
                    }}
                    className={classes(piece(props.lit === part.label), "absolute bg-sheet")}
                  >
                    <span className="truncate px-1">
                      {wide ? `${part.label} ${part.along} × ${part.across}` : part.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )),
      )}
    </section>
  );
}
