import type { BuildPart, BuildStep } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { ChevronDown, CircleHelp } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Shape } from "./picture/close-up-shapes.tsx";
import { mm } from "./words.ts";

// A step's close-up (#699; Paper, "Fabrication · Build steps v2, teaching · Tablet (#699)"): what
// the step makes, drawn flat to scale from the engine's numbers, its key sizes as dimension lines
// and a violet dot where each screw or bolt goes, with the notes beside it. A close-up by type
// (#813) is drawn in 3D by the engine, as faces laid flat, with its labels as pills off it.

type BuildCloseUp = BuildStep["closeUps"][number];

const FILL: Readonly<Record<BuildPart["material"]["kind"], string>> = {
  timber: "fill-timber",
  sheet: "fill-sheet",
  printed: "fill-printed",
};

type Pill = NonNullable<BuildCloseUp["pills"]>[number];
type Face = NonNullable<BuildCloseUp["faces"]>[number];
type Stroke = NonNullable<BuildCloseUp["strokes"]>[number];

/** A pill's words: plain, where to drill first, or where to just screw (#813). */
const PILL_TONE: Readonly<Record<NonNullable<Pill["tone"]>, string>> = {
  plain: "text-foreground",
  warn: "text-destructive",
  fine: "text-success",
};

/** What a face drawn in 3D is (#813): wood, steel, the tape, a tool, the clutch ring, a zone. */
const FACE_FILL: Readonly<Record<Face["fill"], string>> = {
  timber: "fill-timber",
  sheet: "fill-sheet",
  steel: "fill-muted-foreground",
  tape: "fill-warning",
  tool: "fill-fitted",
  ring: "fill-primary",
  "drill-first": "fill-destructive",
  "just-screw": "fill-success",
};

/** A side or an end drawn darker than a top, so the wood reads as a block. */
const SHADE: Readonly<Record<NonNullable<Face["shade"]>, string>> = {
  side: "fill-background/35",
  end: "fill-background/20",
};

const STROKE: Readonly<
  Record<Stroke["look"], { className: string; width: number; dash?: string }>
> = {
  pencil: { className: "stroke-background", width: 2 },
  edge: { className: "stroke-destructive", width: 2 },
  path: { className: "stroke-primary", width: 1.5, dash: "4 3" },
};

/** Where a drawing's mm land in its box once fitted: its scale, in px a mm, and its top left. */
type Fitted = { scale: number; left: number; top: number };

/** How a drawing of `view` (its viewBox) sits in `host`, kept as the host is resized. */
const useFitted = (
  host: RefObject<HTMLDivElement | null>,
  view: { w: number; h: number },
): Fitted | undefined => {
  const [fitted, setFitted] = useState<Fitted>();
  useEffect(() => {
    const box = host.current;
    if (box === null) return;
    const read = () => {
      const { clientWidth: width, clientHeight: height } = box;
      const scale = Math.min(width / view.w, height / view.h);
      setFitted({ scale, left: (width - view.w * scale) / 2, top: (height - view.h * scale) / 2 });
    };
    read();
    const watch = new ResizeObserver(read);
    watch.observe(box);
    return () => watch.disconnect();
  }, [host, view.w, view.h]);
  return fitted;
};

/**
 * The drawing. Its sizes' figures and dots are sized from the drawing's own size, so a 1500 mm
 * top and a 460 mm end frame read the same; lines stay a hair wide however it's scaled. Its words
 * (#783) are over it at the type's own sizes, never under 12 px, placed where they belong.
 */
function Drawing(props: {
  closeUp: BuildCloseUp;
  parts: readonly BuildPart[];
  /** As tall as its width makes it, up to a limit, rather than filling its box. */
  ownHeight?: boolean;
}) {
  const { closeUp, parts } = props;
  const text = Math.max(closeUp.width, closeUp.height) / 16;
  const gap = text * 0.9;
  // Room round it for the sizes' figures; a drawing with none needs only a little.
  const pad = text * (closeUp.dimensions.length > 0 ? 2.4 : 0.5);
  const view = { w: closeUp.width + 2 * pad, h: closeUp.height + 2 * pad };
  const host = useRef<HTMLDivElement>(null);
  const fitted = useFitted(host, view);
  const fillOf = (label: string) => {
    const part = parts.find((each) => each.label === label);
    return part === undefined ? "fill-fitted" : FILL[part.material.kind];
  };
  return (
    <div
      ref={host}
      className={classes("relative w-full", props.ownHeight ? "max-h-60" : "h-full")}
      style={props.ownHeight ? { aspectRatio: view.w / view.h } : undefined}
    >
      <Lines closeUp={closeUp} pad={pad} text={text} gap={gap} view={view} fillOf={fillOf} />
      {(closeUp.pills ?? []).map((pill) => (
        <span
          key={pill.says}
          className={classes(
            "pointer-events-none absolute flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap",
            fitted === undefined && "invisible",
          )}
          style={{
            left: (fitted?.left ?? 0) + (pill.x + pad) * (fitted?.scale ?? 0),
            top: (fitted?.top ?? 0) + (pill.y + pad) * (fitted?.scale ?? 0),
          }}
        >
          {pill.badge !== undefined && (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary text-caption font-bold text-primary-foreground">
              {pill.badge}
            </span>
          )}
          <span
            className={classes(
              "rounded-full border border-border bg-background px-2.5 py-0.5 text-label font-semibold",
              PILL_TONE[pill.tone ?? "plain"],
            )}
          >
            {pill.says}
          </span>
        </span>
      ))}
      {(closeUp.labels ?? []).map((label) => (
        <span
          key={`${label.says} ${label.x} ${label.y}`}
          className={classes(
            "pointer-events-none absolute -translate-y-1/2 whitespace-nowrap",
            fitted === undefined && "invisible",
            !label.heading &&
              (label.key ? "text-label font-semibold text-success" : "text-label text-foreground"),
          )}
          style={{
            left: (fitted?.left ?? 0) + (label.x + pad) * (fitted?.scale ?? 0),
            top: (fitted?.top ?? 0) + (label.y + pad) * (fitted?.scale ?? 0),
          }}
        >
          {label.heading ? (
            <CapsLabel tone="primary" inline>
              {label.says}
            </CapsLabel>
          ) : (
            label.says
          )}
        </span>
      ))}
    </div>
  );
}

/** The drawing's lines and shapes, to scale. */
function Lines(props: {
  closeUp: BuildCloseUp;
  pad: number;
  text: number;
  gap: number;
  view: { w: number; h: number };
  fillOf: (label: string) => string;
}) {
  const { closeUp, pad, text, gap, fillOf } = props;
  return (
    <svg
      role="img"
      aria-label={`${closeUp.title}, with ${closeUp.dimensions.map((line) => `${mm(line.mm)} mm`).join(", ")} marked and ${closeUp.fixings.length} fixings${(closeUp.pills ?? []).map((pill) => `, ${pill.says}`).join("")}`}
      viewBox={`${-pad} ${-pad} ${props.view.w} ${props.view.h}`}
      className="absolute inset-0 h-full w-full"
    >
      {closeUp.pieces.map((piece) => (
        <rect
          key={`${piece.label} ${piece.x} ${piece.y}`}
          x={piece.x}
          y={piece.y}
          width={piece.w}
          height={piece.h}
          className={classes(fillOf(piece.label), "stroke-background")}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {(closeUp.faces ?? []).map((face, at) => {
        const points = face.points.map((point) => `${point.x},${point.y}`).join(" ");
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a drawing's faces are in a fixed order, far to near.
          <g key={at}>
            <polygon
              points={points}
              className={classes(FACE_FILL[face.fill], "stroke-background")}
              strokeWidth={1}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {face.shade !== undefined && <polygon points={points} className={SHADE[face.shade]} />}
          </g>
        );
      })}
      {(closeUp.strokes ?? []).map((stroke, at) => {
        const look = STROKE[stroke.look];
        return (
          <line
            // biome-ignore lint/suspicious/noArrayIndexKey: a drawing's lines are in a fixed order.
            key={at}
            x1={stroke.from.x}
            y1={stroke.from.y}
            x2={stroke.to.x}
            y2={stroke.to.y}
            className={look.className}
            strokeWidth={look.width}
            strokeDasharray={look.dash}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {(closeUp.pills ?? []).flatMap((pill) =>
        pill.to === undefined
          ? []
          : [
              // A leader from the pill to what it's about.
              <line
                key={pill.says}
                x1={pill.x}
                y1={pill.y}
                x2={pill.to.x}
                y2={pill.to.y}
                className="stroke-primary"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />,
            ],
      )}
      {closeUp.dimensions.map((line) => {
        const across = line.from.y === line.to.y;
        // Outside the drawing, on the side the line is nearer.
        const out = across
          ? line.from.y <= closeUp.height / 2
            ? -gap
            : gap
          : line.from.x <= closeUp.width / 2
            ? -gap
            : gap;
        const x1 = line.from.x + (across ? 0 : out);
        const x2 = line.to.x + (across ? 0 : out);
        const y1 = line.from.y + (across ? out : 0);
        const y2 = line.to.y + (across ? out : 0);
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const label = across
          ? { x: midX, y: midY + (out < 0 ? -text * 0.35 : text * 1.05), turn: 0 }
          : { x: midX + (out < 0 ? -text * 0.35 : text * 0.35), y: midY, turn: -90 };
        return (
          <g key={`${x1} ${y1} ${x2} ${y2}`}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="stroke-muted-foreground"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={label.x}
              y={label.y}
              fontSize={text}
              textAnchor="middle"
              transform={label.turn === 0 ? undefined : `rotate(-90 ${label.x} ${label.y})`}
              className="fill-foreground font-mono"
            >
              {mm(line.mm)}
            </text>
          </g>
        );
      })}
      {closeUp.fixings.map((dot) => (
        <circle
          key={`${dot.x} ${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          // A close-up by type's screw spots and heads are small, beside its crosses (#813).
          r={text * (closeUp.type === undefined ? 0.28 : 0.1)}
          className="fill-primary"
        />
      ))}
      {(closeUp.shapes ?? []).map((shape) => (
        <Shape key={`${shape.kind} ${shape.x} ${shape.y}`} shape={shape} />
      ))}
    </svg>
  );
}

/** The close-up, its title in capitals and its notes beside the drawing, or under it when narrow. */
export function CloseUp(props: {
  closeUp: BuildCloseUp;
  parts: readonly BuildPart[];
  narrow?: boolean;
}) {
  const { closeUp } = props;
  // A drawing with words on it is as tall as it needs to be for them, when narrow (#783, #813).
  const ownHeight =
    props.narrow === true && (closeUp.labels ?? []).length + (closeUp.pills ?? []).length > 0;
  return (
    <section
      aria-label="Close-up"
      className={classes(
        "flex gap-4 rounded-card bg-muted p-4",
        props.narrow ? "flex-col" : "min-h-0 items-center",
      )}
    >
      <div
        className={classes(
          "min-w-0",
          props.narrow ? !ownHeight && "h-44" : "h-full max-h-56 flex-1",
        )}
      >
        <Drawing closeUp={closeUp} parts={props.parts} ownHeight={ownHeight} />
      </div>
      <div className={classes("flex flex-col gap-2", !props.narrow && "w-2/5 shrink-0")}>
        <CapsLabel tone="muted" heading={{ level: 3 }}>
          Close-up · {closeUp.title}
        </CapsLabel>
        <ul className="flex flex-col gap-1.5 text-interface text-foreground">
          {closeUp.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The techniques a step uses (#813): each close-up in full the first time the Build's steps use
 * it, and after that a small "how?" tap that opens it.
 */
export function Techniques(props: { step: BuildStep; parts: readonly BuildPart[] }) {
  return props.step.techniques.map(({ closeUp, first }) =>
    first ? (
      <CloseUp key={closeUp.title} closeUp={closeUp} parts={props.parts} narrow />
    ) : (
      <details key={closeUp.title} className="group flex flex-col gap-2">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-full bg-muted px-4 text-interface font-semibold text-foreground">
          <CircleHelp aria-hidden className="size-4 text-primary-text" />
          How? {closeUp.title}
          <ChevronDown aria-hidden className="size-4 group-open:rotate-180" />
        </summary>
        <CloseUp closeUp={closeUp} parts={props.parts} narrow />
      </details>
    ),
  );
}
