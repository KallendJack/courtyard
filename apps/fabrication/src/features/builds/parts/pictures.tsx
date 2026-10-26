import type { BuildBagItem, BuildPart } from "@courtyard/contract";

// The parts page's pictures (#778; Paper, 2 · Agreed, "Fabrication · Parts page, any build · Fold
// 933×645 (#778)"): each piece in 3D at one scale for the whole Build, so the longest looks
// longest and ply looks like ply, and each fixing in the bag as its shape.

/** How far a piece's depth runs back, up and to the right, for each unit of it. */
const BACK = { x: 0.6, y: 0.35 };
/** The fewest pixels a piece's face is drawn, so a thin sheet still reads. */
const LEAST = 3;
/**
 * A section's pixels a mm: a timber's width and thickness, and a sheet's thickness, drawn bigger
 * than its length so they read; lengths, and a sheet's width, share the Build's own scale.
 */
const SECTION = 0.22;

/**
 * A piece in 3D: its front face along its length, its top running back, its end. Timber lies on
 * its wide face; a sheet lies flat, its edge showing its plies. `scale` is the Build's, in pixels
 * a mm.
 */
export function Piece(props: { part: BuildPart; scale: number }) {
  const { part, scale } = props;
  const sheet = part.material.kind === "sheet";
  const along = Math.max(LEAST, part.length * scale);
  const high = Math.max(LEAST, part.thickness * SECTION);
  const deep = Math.max(LEAST, part.width * (sheet ? scale : SECTION));
  const back = { x: deep * BACK.x, y: deep * BACK.y };
  const pad = 2;
  const width = along + back.x + 2 * pad;
  const height = high + back.y + 2 * pad;
  const at = (x: number, y: number) => `${pad + x},${height - pad - y}`;
  const fill = sheet ? "fill-sheet" : "fill-timber";
  const front = [at(0, 0), at(along, 0), at(along, high), at(0, high)].join(" ");
  const top = [
    at(0, high),
    at(along, high),
    at(along + back.x, high + back.y),
    at(back.x, high + back.y),
  ].join(" ");
  const end = [
    at(along, 0),
    at(along + back.x, back.y),
    at(along + back.x, high + back.y),
    at(along, high),
  ].join(" ");
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polygon points={top} className={`${fill} stroke-background`} strokeWidth={1} />
      <polygon points={front} className={`${fill} stroke-background`} strokeWidth={1} />
      <polygon points={front} className="fill-background/35" />
      <polygon points={end} className={`${fill} stroke-background`} strokeWidth={1} />
      <polygon points={end} className="fill-background/20" />
      {sheet && (
        // Its plies, along its edge.
        <line
          x1={pad}
          x2={pad + along}
          y1={height - pad - high / 2}
          y2={height - pad - high / 2}
          className="stroke-background/60"
          strokeWidth={1}
        />
      )}
    </svg>
  );
}

/** The scale the Build's pieces are drawn at: its longest piece `widest` pixels along. */
export const pieceScale = (parts: readonly BuildPart[], widest: number) =>
  widest /
  Math.max(
    1,
    ...parts.map(
      (part) => part.length + (part.material.kind === "sheet" ? part.width * BACK.x : 0),
    ),
  );

/** A screw's length from its name as shops give it, "5 × 80 screws": 80; none when it doesn't say. */
const screwLength = (name: string) => Number(/×\s*(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);

/** A fixing in the bag as its shape: a screw by its length, a bracket, a bolt set, a castor. */
export function Fixing(props: { item: BuildBagItem }) {
  const { kind, name } = props.item;
  const steel = "fill-muted-foreground";
  const shape = (() => {
    switch (kind) {
      case "screw": {
        // The longest screws a fixing bag holds are about 100 mm.
        const long = 14 + Math.min(1, screwLength(name) / 100) * 26;
        return (
          <>
            <circle cx={5} cy={12} r={4} className={steel} />
            <rect x={8} y={11} width={long} height={2} className={steel} />
          </>
        );
      }
      case "bracket":
        return <path d="M10 2 h4 v16 h16 v4 h-20 z" className={steel} />;
      case "bolt-set":
      case "bolt":
        return (
          <>
            <rect x={2} y={7} width={4} height={10} className={steel} />
            <rect x={6} y={11} width={20} height={2} className={steel} />
            {kind === "bolt-set" && (
              <>
                <rect x={29} y={6} width={2} height={12} className={steel} />
                <rect x={34} y={8} width={5} height={8} className={steel} />
              </>
            )}
          </>
        );
      case "washer":
        return <circle cx={20} cy={12} r={7} className={`${steel} stroke-background`} />;
      case "nut":
        return <path d="M14 12 l3 -6 h6 l3 6 l-3 6 h-6 z" className={steel} />;
      case "castor":
        return (
          <>
            <rect x={10} y={2} width={20} height={3} className={steel} />
            <rect x={17} y={5} width={6} height={5} className={steel} />
            <circle cx={20} cy={16} r={6} className="fill-fitted" />
            <circle cx={20} cy={16} r={2} className="fill-background" />
          </>
        );
      default:
        return <circle cx={20} cy={12} r={5} className="fill-fitted" />;
    }
  })();
  return (
    <svg aria-hidden width={40} height={24} viewBox="0 0 40 24" className="shrink-0">
      {shape}
    </svg>
  );
}
