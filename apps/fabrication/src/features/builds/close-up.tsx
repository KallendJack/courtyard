import type { BuildPart, BuildStep } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { mm } from "./words.ts";

// A step's close-up (#699; Paper, "Fabrication · Build steps v2, teaching · Tablet (#699)"): what
// the step makes, drawn flat to scale from the engine's numbers, its key sizes as dimension lines
// and a violet dot where each screw or bolt goes, with the notes beside it.

type BuildCloseUp = NonNullable<BuildStep["closeUp"]>;

const FILL: Readonly<Record<BuildPart["material"]["kind"], string>> = {
  timber: "fill-timber",
  sheet: "fill-sheet",
  printed: "fill-printed",
};

/**
 * The drawing. Its text and dots are sized from the drawing's own size, so a 1500 mm top and a
 * 460 mm end frame read the same; lines stay a hair wide however it's scaled.
 */
function Drawing(props: { closeUp: BuildCloseUp; parts: readonly BuildPart[] }) {
  const { closeUp, parts } = props;
  const text = Math.max(closeUp.width, closeUp.height) / 16;
  const gap = text * 0.9;
  const pad = text * 2.4;
  const fillOf = (label: string) => {
    const part = parts.find((each) => each.label === label);
    return part === undefined ? "fill-fitted" : FILL[part.material.kind];
  };
  return (
    <svg
      role="img"
      aria-label={`${closeUp.title}, with ${closeUp.dimensions.map((line) => `${mm(line.mm)} mm`).join(", ")} marked and ${closeUp.fixings.length} fixings`}
      viewBox={`${-pad} ${-pad} ${closeUp.width + 2 * pad} ${closeUp.height + 2 * pad}`}
      className="h-full max-h-full w-full"
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
  return (
    <section
      aria-label="Close-up"
      className={classes(
        "flex gap-4 rounded-card bg-muted p-4",
        props.narrow ? "flex-col" : "min-h-0 items-center",
      )}
    >
      <div className={classes("min-w-0", props.narrow ? "h-44" : "h-full max-h-56 flex-1")}>
        <Drawing closeUp={closeUp} parts={props.parts} />
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
