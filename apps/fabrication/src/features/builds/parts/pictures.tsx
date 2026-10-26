import type { BuildBagItem, BuildPart } from "@courtyard/contract";

// The parts page's pictures (#778; Paper, 2 · Agreed, "Fabrication · Parts page, any build · Fold
// 933×645 (#778)"): each piece in 3D at one scale for the whole Build, so the longest looks
// longest and ply looks like ply, and each fixing in the bag as its shape.

/** A piece's picture, as the board draws it: this wide and at least this high, in pixels. */
export const PICTURE = { width: 160, height: 36 };
/** The room left round a piece in its picture. */
const PAD = 2;
/** A section's pixels a mm: a piece's thickness, drawn bigger than its length so it reads. */
const THICK = 0.28;
/** The fewest pixels a sheet's edge is drawn, so a thin sheet still reads. */
const LEAST = 5;
/**
 * How far a piece's width runs back, up and to the right, for each mm of it: a timber's a lot, so
 * its top reads; a sheet's less, so a wide one still fits.
 */
const BACK = { timber: { x: 0.09, y: 0.06 }, sheet: { x: 0.04, y: 0.03 } };

const isSheet = (part: BuildPart) => part.material.kind === "sheet";
const isPly = (part: BuildPart) =>
  part.material.kind === "sheet" && /ply/i.test(part.material.stock);

/** A piece's section as drawn: its edge's height, and how far its width runs back. */
const sectionOf = (part: BuildPart) => {
  const back = isSheet(part) ? BACK.sheet : BACK.timber;
  return {
    high: Math.max(isSheet(part) ? LEAST : 1, part.thickness * THICK),
    back: { x: part.width * back.x, y: part.width * back.y },
  };
};

/**
 * A piece in 3D, as its board draws it: its front along its length, its top lit, running back,
 * its end shaded. Timber lies on its edge; a sheet lies flat, ply with its plies along its edge.
 * `scale` is the Build's, in pixels a mm.
 */
export function Piece(props: { part: BuildPart; scale: number }) {
  const { part } = props;
  const along = Math.max(1, part.length * props.scale);
  const { high, back } = sectionOf(part);
  const height = Math.max(PICTURE.height, high + back.y + 2 * PAD);
  const at = (x: number, y: number) => `${PAD + x},${height - PAD - y}`;
  const fill = isPly(part) ? "fill-ply" : isSheet(part) ? "fill-sheet" : "fill-timber";
  const top = [
    at(0, high),
    at(along, high),
    at(along + back.x, high + back.y),
    at(back.x, high + back.y),
  ];
  const front = [at(0, 0), at(along, 0), at(along, high), at(0, high)];
  const end = [
    at(along, 0),
    at(along + back.x, back.y),
    at(along + back.x, high + back.y),
    at(along, high),
  ];
  const face = (points: string[], shade?: string) => (
    <>
      <polygon points={points.join(" ")} className={fill} />
      {shade !== undefined && <polygon points={points.join(" ")} className={shade} />}
      <polygon
        points={points.join(" ")}
        className="fill-none stroke-background"
        strokeWidth={0.8}
      />
    </>
  );
  return (
    <svg
      aria-hidden
      width={PICTURE.width}
      height={height}
      viewBox={`0 0 ${PICTURE.width} ${height}`}
      className="shrink-0"
    >
      <g data-piece>
        {face(top, "fill-foreground/25")}
        {face(front)}
        {isPly(part) &&
          // Its plies, along its edge.
          [1, 2].map((ply) => (
            <line
              key={ply}
              x1={PAD}
              x2={PAD + along}
              y1={height - PAD - (high * ply) / 3}
              y2={height - PAD - (high * ply) / 3}
              className="stroke-background/30"
              strokeWidth={0.6}
            />
          ))}
        {face(end, "fill-background/12")}
      </g>
    </svg>
  );
}

/**
 * The scale the Build's pieces are drawn at, in pixels a mm: the most that fits each piece,
 * its width running back too, in its picture.
 */
export const pieceScale = (parts: readonly BuildPart[]) =>
  Math.min(
    ...parts.map(
      (part) => (PICTURE.width - 2 * PAD - 3 - sectionOf(part).back.x) / Math.max(1, part.length),
    ),
  );

/** A screw's length from its name as shops give it, "5 × 80 screws": 80; none when it doesn't say. */
const screwLength = (name: string) => Number(/×\s*(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);

/** Steel, as the board draws it: a head bright, a shank a little less, threads and nuts duller. */
const STEEL = {
  head: "fill-foreground/85",
  plate: "fill-foreground/80",
  shank: "stroke-foreground/75",
  dull: "fill-muted-foreground",
  dark: "fill-foreground/25",
  hole: "fill-input",
};
/** A shape with the dark edge every picture has. */
const edged = (fill: string) => ({ className: `${fill} stroke-background`, strokeWidth: 0.8 });

/** A screw, its length drawn by its own: a head, a shank and its thread. */
function Screw(props: { length: number }) {
  // The longest screws a fixing bag holds are about 80 mm; one that doesn't say is drawn short.
  const mm = props.length > 0 ? props.length : 40;
  const long = mm >= 60;
  const head = long ? 5 : 4;
  const end = Math.min(42, 10 + 0.4 * mm);
  const threads = [];
  for (let x = 13; x <= end - 4; x += long ? 5 : 4) threads.push(x);
  return (
    <>
      <circle cx={6} cy={12} r={head} {...edged(STEEL.head)} />
      <line
        x1={6 + head}
        y1={12}
        x2={end}
        y2={12}
        className={STEEL.shank}
        strokeWidth={long ? 3 : 2.4}
        strokeLinecap="round"
      />
      <path
        d={threads.map((x) => (long ? `M${x} 9 l3 6` : `M${x} 10 l2 4`)).join(" ")}
        className="fill-none stroke-muted-foreground"
      />
    </>
  );
}

/** A fixing in the bag as its shape: a screw by its length, a bracket, a bolt set, a castor. */
export function Fixing(props: { item: BuildBagItem }) {
  const { kind, name } = props.item;
  const shape = (() => {
    switch (kind) {
      case "screw":
        return <Screw length={screwLength(name)} />;
      case "bracket":
        return (
          <>
            <polygon points="10,2 16,2 16,16 34,16 34,22 10,22" {...edged(STEEL.plate)} />
            <circle cx={13} cy={8} r={1.6} className={STEEL.hole} />
            <circle cx={25} cy={19} r={1.6} className={STEEL.hole} />
          </>
        );
      case "bolt-set":
      case "bolt":
        return (
          <>
            <rect x={1} y={7} width={5} height={10} {...edged(STEEL.head)} />
            <line x1={6} y1={12} x2={26} y2={12} className={STEEL.shank} strokeWidth={3} />
            {kind === "bolt-set" && (
              <>
                <rect
                  x={29}
                  y={5}
                  width={2.5}
                  height={14}
                  className="fill-success stroke-background"
                  strokeWidth={0.6}
                />
                <rect x={34} y={7} width={6} height={10} {...edged(STEEL.dull)} />
              </>
            )}
          </>
        );
      case "washer":
        return (
          <>
            <circle cx={20} cy={12} r={7} {...edged(STEEL.plate)} />
            <circle cx={20} cy={12} r={2.5} className="fill-background" />
          </>
        );
      case "nut":
        return <path d="M14 12 l3 -6 h6 l3 6 l-3 6 h-6 z" {...edged(STEEL.dull)} />;
      case "castor":
        return (
          <>
            <rect x={12} y={0} width={20} height={4} {...edged(STEEL.plate)} />
            <rect x={19} y={4} width={6} height={5} {...edged(STEEL.dull)} />
            <circle cx={22} cy={16} r={8} {...edged(STEEL.dark)} />
            <circle cx={22} cy={16} r={3} className={STEEL.dull} />
          </>
        );
      default:
        return <circle cx={22} cy={12} r={6} {...edged("fill-fitted")} />;
    }
  })();
  return (
    <svg aria-hidden width={44} height={24} viewBox="0 0 44 24" className="shrink-0">
      {shape}
    </svg>
  );
}
