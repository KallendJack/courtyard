import type { BuildPart, BuildStep } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { type RefObject, useEffect, useRef, useState } from "react";
import { mm } from "./words.ts";

// A step's close-up (#699; Paper, "Fabrication · Build steps v2, teaching · Tablet (#699)"): what
// the step makes, drawn flat to scale from the engine's numbers, its key sizes as dimension lines
// and a violet dot where each screw or bolt goes, with the notes beside it.

type BuildCloseUp = BuildStep["closeUps"][number];

const FILL: Readonly<Record<BuildPart["material"]["kind"], string>> = {
  timber: "fill-timber",
  sheet: "fill-sheet",
  printed: "fill-printed",
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
      aria-label={`${closeUp.title}, with ${closeUp.dimensions.map((line) => `${mm(line.mm)} mm`).join(", ")} marked and ${closeUp.fixings.length} fixings`}
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
          r={text * 0.28}
          className="fill-primary"
        />
      ))}
      {(closeUp.shapes ?? []).map((shape) => (
        <Shape key={`${shape.kind} ${shape.x} ${shape.y}`} shape={shape} />
      ))}
    </svg>
  );
}

type CloseUpShape = NonNullable<BuildCloseUp["shapes"]>[number];

/**
 * A tool or a nut drawn as its shape (#783), never as a bar: a hex nut or bolt head, an open
 * spanner, an adjustable, pliers or a socket on one, its jaw at the shape's point and its handle
 * out `length` at `turn` degrees, and a clockwise arrow round one.
 */
function Shape(props: { shape: CloseUpShape }) {
  const { shape } = props;
  if (shape.kind === "hex") {
    // Flats top and bottom, as a spanner's jaws hold it.
    const r = shape.across / Math.sqrt(3);
    const points = Array.from({ length: 6 }, (_, at) => {
      const angle = (at * Math.PI) / 3;
      return `${shape.x + r * Math.cos(angle)},${shape.y + r * Math.sin(angle)}`;
    }).join(" ");
    return (
      <polygon
        points={points}
        className="fill-fitted stroke-background"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (shape.kind === "castor") {
    // Upside down: its plate, the swivel standing on it, and the wheel on top with its axle.
    const swivel = { w: shape.w * 0.45, h: Math.max(shape.wheel * 0.3, 6) };
    const middle = shape.x + shape.w / 2;
    const r = shape.wheel / 2;
    const axle = shape.y - swivel.h - r;
    return (
      <g
        className="fill-fitted stroke-background"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      >
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.plate}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M ${middle - swivel.w / 2} ${shape.y} L ${middle - swivel.w / 3} ${shape.y - swivel.h} L ${middle + swivel.w / 3} ${shape.y - swivel.h} L ${middle + swivel.w / 2} ${shape.y} Z`}
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={middle} cy={axle} r={r} vectorEffect="non-scaling-stroke" />
        <circle cx={middle} cy={axle} r={r * 0.6} className="fill-muted" />
        <circle cx={middle} cy={axle} r={r * 0.18} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  if (shape.kind === "clockwise") {
    // Three quarters of a turn, clockwise from the left, ending in its head.
    const { x, y, r } = shape;
    const head = r * 0.35;
    return (
      <g className="fill-none stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke">
        <path
          d={`M ${x - r} ${y} A ${r} ${r} 0 1 1 ${x} ${y + r}`}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M ${x + head} ${y + r - head} L ${x} ${y + r} L ${x + head} ${y + r + head}`}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }
  const j = shape.jaw;
  const half = j / 2;
  return (
    <g
      transform={`translate(${shape.x} ${shape.y}) rotate(${shape.turn})`}
      className="fill-foreground/85"
    >
      {shape.kind === "pliers" ? (
        <>
          {/* Two jaws either side of what they grip, a pivot, and the handles opening out. */}
          <rect x={-0.3 * j} y={-half - 0.4 * j} width={1.9 * j} height={0.4 * j} rx={0.1 * j} />
          <rect x={-0.3 * j} y={half} width={1.9 * j} height={0.4 * j} rx={0.1 * j} />
          <circle cx={1.8 * j} cy={0} r={0.55 * j} />
          <polygon
            points={`${1.8 * j},${-0.3 * j} ${shape.length},${-1.1 * j} ${shape.length},${-0.6 * j} ${1.8 * j},${0.1 * j}`}
          />
          <polygon
            points={`${1.8 * j},${0.3 * j} ${shape.length},${1.1 * j} ${shape.length},${0.6 * j} ${1.8 * j},${-0.1 * j}`}
          />
        </>
      ) : shape.kind === "socket" ? (
        <>
          {/* The socket over the nut, and the ratchet's handle. */}
          <circle cx={0} cy={0} r={0.95 * j} />
          <circle cx={1.4 * j} cy={0} r={0.7 * j} />
          <rect
            x={1.4 * j}
            y={-0.3 * j}
            width={shape.length - 1.4 * j}
            height={0.6 * j}
            rx={0.3 * j}
          />
        </>
      ) : (
        <>
          {/* An open jaw round the hex, the rest of the head round it, and the handle. */}
          <OpenHead jaw={j} radius={shape.kind === "adjustable" ? 1.35 * j : 1.1 * j} />
          <rect
            x={0.8 * j}
            y={-(shape.kind === "adjustable" ? 0.42 : 0.32) * j}
            width={shape.length - 0.8 * j}
            height={(shape.kind === "adjustable" ? 0.84 : 0.64) * j}
            rx={0.3 * j}
          />
          {shape.kind === "adjustable" && (
            // The worm that winds the jaw, and the hole in the handle's end.
            <>
              <circle cx={0.25 * j} cy={0.95 * j} r={0.22 * j} className="fill-muted" />
              <circle cx={shape.length - 0.5 * j} cy={0} r={0.18 * j} className="fill-muted" />
            </>
          )}
        </>
      )}
    </g>
  );
}

/** A spanner's open head: round, with a slot `jaw` wide opening away from its handle. */
function OpenHead(props: { jaw: number; radius: number }) {
  const half = props.jaw / 2;
  const r = props.radius;
  const mouth = -Math.sqrt(r * r - half * half);
  // The slot's floor sits just past the hex's far corner.
  const floor = 0.6 * props.jaw;
  return (
    <path
      d={`M ${mouth} ${-half} L ${floor} ${-half} L ${floor} ${half} L ${mouth} ${half} A ${r} ${r} 0 1 0 ${mouth} ${-half} Z`}
    />
  );
}

/** The close-up, its title in capitals and its notes beside the drawing, or under it when narrow. */
export function CloseUp(props: {
  closeUp: BuildCloseUp;
  parts: readonly BuildPart[];
  narrow?: boolean;
}) {
  const { closeUp } = props;
  // A drawing with words on it is as tall as it needs to be for them, when narrow (#783).
  const ownHeight = props.narrow === true && (closeUp.labels ?? []).length > 0;
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
