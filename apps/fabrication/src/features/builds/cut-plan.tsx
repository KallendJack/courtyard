import type { BuildCutPlan, BuildStep, DerivedBuild } from "@courtyard/contract";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { assumedSizes, metres } from "./words.ts";

type Length = BuildCutPlan["timber"][number]["lengths"][number];
/** A length as the marking step marks it (#754). */
type BuildMarkedLength = NonNullable<BuildStep["actions"][number]["length"]>;

/** The type a piece's words are in: the probe that measures them uses it too. */
const PIECE_TYPE = "font-mono text-meta font-semibold";

/** A part's piece, lit while it's the one tapped (#698), here as in the 3D view and its key. */
const piece = (lit: boolean) =>
  classes(
    "flex min-w-0 items-center justify-center overflow-hidden rounded-sm text-background",
    PIECE_TYPE,
    lit && "ring-stroke ring-primary-text ring-offset-2 ring-offset-surface",
  );

/** The room a piece's words leave at its edges, in CSS px: `px-1` each side, and a little more. */
const EDGE = 10;

/** How wide the cut plan is drawn, and how wide its pieces' words are, measured on the page. */
type Room = { width: number; line: number; measure: (text: string) => number };

/**
 * The cut plan's width and its pieces' type, measured before it's painted and again as it
 * resizes or its font arrives, so each piece's words are laid out to fit it (#753).
 */
const useRoom = (plan: RefObject<HTMLElement | null>, probe: RefObject<HTMLElement | null>) => {
  const [room, setRoom] = useState<Room>();
  useLayoutEffect(() => {
    const [box, type] = [plan.current, probe.current];
    const drawing = document.createElement("canvas").getContext("2d");
    if (box === null || type === null || drawing === null) return;
    const read = () => {
      const style = getComputedStyle(type);
      drawing.font = style.font;
      const size = Number.parseFloat(style.fontSize);
      const line = Number.parseFloat(style.lineHeight);
      setRoom({
        width: box.clientWidth,
        line: Number.isNaN(line) ? size * 1.4 : line,
        measure: (text) => drawing.measureText(text).width,
      });
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(box);
    void document.fonts.ready.then(read);
    return () => watch.disconnect();
  }, [plan, probe]);
  return room;
};

/** How a sheet piece's words sit: each layout's lines, and whether they're turned along it. */
type Words = { lines: readonly string[]; turned: boolean };

/**
 * A sheet piece's words (#753): its letter and size on one line, or its size on the next line
 * when it's narrow, turned along it when it's tall, its size in two lines if need be, and its
 * letter alone only when none of those fit.
 */
const wordsFor = (
  room: Room | undefined,
  piece: { label: string; along: number; across: number },
  sheetLength: number,
) => {
  const { label, along, across } = piece;
  const letterOnly: Words = { lines: [label], turned: false };
  if (room === undefined) return letterOnly;
  // The sheet is drawn the plan's width, so a millimetre is that width over the sheet's length.
  const px = (mm: number) => (mm / sheetLength) * room.width;
  const [w, h] = [px(along), px(across)];
  const fits = (lines: readonly string[], width: number, height: number) =>
    Math.max(...lines.map(room.measure)) + EDGE <= width && lines.length * room.line <= height;
  const sized = `${along} × ${across}`;
  const ways: Words[] = [
    { lines: [`${label} ${sized}`], turned: false },
    { lines: [label, sized], turned: false },
    ...(h > w
      ? [
          { lines: [`${label} ${sized}`], turned: true },
          { lines: [label, sized], turned: true },
        ]
      : []),
    { lines: [label, `${along} ×`, `${across}`], turned: false },
  ];
  return (
    ways.find((way) => (way.turned ? fits(way.lines, h, w) : fits(way.lines, w, h))) ?? letterOnly
  );
};

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

/**
 * A group's line: what it's cut from and how many, the offcut when its bar has no room for it
 * (#753), and its stock's options on its first (#704).
 */
function StockLine(props: {
  name: string;
  count: number;
  offcut?: number;
  options: (() => void) | undefined;
}) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-interface text-foreground">
      <span className="min-w-0 font-semibold">{props.name}</span>
      <span className="flex shrink-0 items-baseline gap-3">
        <span className="font-mono text-meta text-muted-foreground">
          × {props.count}
          {props.offcut !== undefined && ` · offcut ${props.offcut}`}
        </span>
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
 * as long as it is, with the offcut left and how long it is (#753); and each sheet with its pieces
 * where they sit, each with its size. Tapping a piece lights its part everywhere and opens its
 * card.
 */
export function CutPlan(props: {
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
  openOptions: (stock: string) => void;
}) {
  const { cutPlan } = props.derived;
  const plan = useRef<HTMLElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const room = useRoom(plan, probe);
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
    <section ref={plan} aria-label="Cut plan" className="relative flex flex-col gap-4">
      <span ref={probe} aria-hidden className={classes(PIECE_TYPE, "invisible absolute")} />
      <p className="text-meta text-muted-foreground">
        Each saw cut takes {cutPlan.kerf} mm{assumed ? " · assumed" : ""}
      </p>
      {cutPlan.timber.flatMap((timber) =>
        sameCuts(timber.lengths).map(({ length, count }, group) => {
          const label = `offcut ${length.offcut}`;
          const roomy =
            room !== undefined &&
            room.measure(label) + EDGE <= (length.offcut / timber.stockLength) * room.width;
          return (
            <section
              key={`${timber.stock}:${length.cuts.map((cut) => cut.label).join()}`}
              className="flex flex-col gap-1.5"
            >
              <StockLine
                name={`${timber.stock}, ${metres(timber.stockLength)}`}
                count={count}
                {...(roomy || length.offcut <= 0 ? {} : { offcut: length.offcut })}
                options={optionsOf(timber.stock, group === 0)}
              />
              <div className="flex h-11 gap-px rounded-sm bg-muted">
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
                {roomy && (
                  <span className="flex min-w-0 flex-1 items-center justify-center font-mono text-meta text-muted-foreground">
                    <span className="truncate px-1">{label}</span>
                  </span>
                )}
              </div>
            </section>
          );
        }),
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
                const words = wordsFor(room, part, sheet.sheetLength);
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
                    <span
                      className={classes(
                        "flex flex-col items-center px-1",
                        words.turned && "rotate-180 [writing-mode:vertical-rl]",
                      )}
                    >
                      {words.lines.map((line) => (
                        <span key={line} className="whitespace-nowrap">
                          {line}
                        </span>
                      ))}
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
