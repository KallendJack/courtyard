import type { BuildStep } from "@courtyard/contract";

// The tools, nuts and castors a close-up draws as their shape (#783), out of close-up.tsx (over
// 400 lines).

type BuildCloseUp = BuildStep["closeUps"][number];
type CloseUpShape = NonNullable<BuildCloseUp["shapes"]>[number];

/**
 * A tool or a nut drawn as its shape (#783), never as a bar: a hex nut or bolt head, an open
 * spanner, an adjustable, pliers or a socket on one, its jaw at the shape's point and its handle
 * out `length` at `turn` degrees, and a clockwise arrow round one.
 */
export function Shape(props: { shape: CloseUpShape }) {
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
      // Turned from underneath in red, as the castors' board draws it (#826).
      className={shape.under === true ? "fill-destructive" : "fill-foreground/85"}
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
