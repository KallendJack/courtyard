import type { BikePlace } from "@courtyard/contract";
import { classes } from "@/lib/classes";

// Courtyard's drawing of a mountain bike (#603; Paper, "Tablet · Mountain biking Home: the bike,
// then projects (#603)"), the first kind of thing it draws: side on, front wheel on the right, in
// the theme's greys. Drawn by the web app, never by a model. Each place a part goes has a pin on
// the bike, a line out to its label, and where that label sits; the part's own strokes light up
// with it.

/** The drawing's size, as its coordinates count. */
export const BIKE_WIDTH = 622;
export const BIKE_HEIGHT = 300;

type Point = readonly [x: number, y: number];

/** Where each place's pin is on the bike, where its line ends at the label, and the label's top left. */
export const BIKE_SPOTS: Readonly<
  Record<BikePlace, { readonly pin: Point; readonly line: Point; readonly label: Point }>
> = {
  saddle: { pin: [236, 58], line: [214, 27], label: [150, 14] },
  seatpost: { pin: [259, 78], line: [318, 35], label: [300, 22] },
  grips: { pin: [401, 54], line: [462, 35], label: [462, 22] },
  fork: { pin: [436, 170], line: [500, 123], label: [500, 110] },
  brakes: { pin: [190, 181], line: [84, 153], label: [18, 140] },
  drivetrain: { pin: [284, 229], line: [285, 262], label: [246, 262] },
  pedals: { pin: [314, 240], line: [362, 262], label: [330, 262] },
  "front-tyre": { pin: [525, 242], line: [545, 266], label: [536, 262] },
  "rear-tyre": { pin: [97, 242], line: [76, 266], label: [12, 262] },
};

/** One stroke of the drawing, in its theme colour, and the place it belongs to, if any. */
type Stroke = {
  readonly d: string;
  readonly className: string;
  readonly width: number;
  readonly place?: BikePlace;
  readonly fill?: boolean;
};

/** A circle as a path, so every stroke is drawn alike. */
const ring = (x: number, y: number, r: number) =>
  `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** One wheel, its tyre belonging to a place. */
const wheel = (x: number, place: BikePlace): Stroke[] => [
  {
    d: `M${x} 128 L${x} 272 M${x - 72} 200 L${x + 72} 200 M${x - 51} 149 L${x + 51} 251 M${x - 51} 251 L${x + 51} 149`,
    className: "stroke-input",
    width: 1.2,
  },
  { d: ring(x, 200, 74), className: "stroke-foreground/30", width: 3 },
  { d: ring(x, 200, 82), className: "stroke-foreground/20", width: 12, place },
  {
    d: ring(x, 200, 89),
    className: "stroke-foreground/20 [stroke-dasharray:4_4]",
    width: 5,
    place,
  },
  { d: ring(x, 200, 20), className: "stroke-placeholder", width: 3 },
];

const STROKES: readonly Stroke[] = [
  ...wheel(170, "rear-tyre"),
  ...wheel(452, "front-tyre"),
  { d: ring(170, 200, 12), className: "stroke-muted-foreground", width: 2.5, place: "drivetrain" },
  {
    d: "M290 195 L170 188 M290 229 L178 232 L170 212",
    className: "stroke-foreground/35",
    width: 2,
    place: "drivetrain",
  },
  {
    d: "M170 204 L166 226 L180 234",
    className: "stroke-muted-foreground",
    width: 3.5,
    place: "drivetrain",
  },
  // The frame.
  { d: "M290 212 L170 200 M274 134 L170 200", className: "stroke-foreground/80", width: 6 },
  { d: "M290 212 L262 92 M400 96 L270 126", className: "stroke-foreground/80", width: 8 },
  { d: "M410 116 L290 212", className: "stroke-foreground/80", width: 12 },
  { d: "M398 84 L413 120", className: "stroke-foreground/80", width: 11 },
  // The fork: its stanchion, crown and lowers.
  { d: "M412 124 L430 158", className: "stroke-foreground/90", width: 6, place: "fork" },
  { d: "M404 128 L421 119", className: "stroke-foreground/60", width: 7, place: "fork" },
  { d: "M426 150 L450 200", className: "stroke-foreground/60", width: 10, place: "fork" },
  // The stem and bars, the grip, the brake lever.
  { d: "M394 80 L412 76 M412 76 L404 60", className: "stroke-foreground/80", width: 5 },
  { d: "M403 58 L399 50", className: "stroke-placeholder", width: 10, place: "grips" },
  { d: "M406 64 L424 72", className: "stroke-muted-foreground", width: 2.5, place: "brakes" },
  // The calipers, rear and front.
  { d: "M184 178 L196 184", className: "stroke-muted-foreground", width: 7, place: "brakes" },
  { d: "M436 182 L444 192", className: "stroke-muted-foreground", width: 7, place: "brakes" },
  { d: "M262 92 L257 66", className: "stroke-foreground/60", width: 6, place: "seatpost" },
  {
    d: "M228 60 Q246 52 280 56 L282 60 Q254 62 230 64 Z",
    className: "fill-foreground/80 stroke-foreground/80",
    width: 3,
    place: "saddle",
    fill: true,
  },
  { d: ring(290, 212, 17), className: "stroke-muted-foreground", width: 3, place: "drivetrain" },
  { d: "M290 212 L306 238", className: "stroke-foreground/65", width: 5, place: "pedals" },
  {
    d: "M296 236 L318 236 L318 242 L296 242 Z",
    className: "fill-placeholder stroke-placeholder",
    width: 2,
    place: "pedals",
    fill: true,
  },
];

/**
 * The bike, its parts' pins and the lines out to their labels (the labels themselves are the
 * page's, as links, over it). `pins` are the places that have a part; `lit` is the one whose label
 * is pointed at or focused, drawn in violet. It fills its box, which keeps the drawing's shape.
 */
export function MountainBike(props: {
  pins: readonly BikePlace[];
  lit: BikePlace | undefined;
  /** The lines out to labels: off on the cover screen, where the labels are listed under it. */
  lines: boolean;
  label: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${BIKE_WIDTH} ${BIKE_HEIGHT}`}
      role="img"
      aria-label={props.label}
      className="absolute inset-0 size-full"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {STROKES.map((stroke) => (
        <path
          key={stroke.d}
          d={stroke.d}
          strokeWidth={stroke.width}
          className={classes(
            stroke.fill ? undefined : "fill-none",
            stroke.place !== undefined && stroke.place === props.lit
              ? classes("stroke-primary-text", stroke.fill && "fill-primary-text")
              : stroke.className,
          )}
        />
      ))}
      <path d={ring(170, 200, 4)} className="fill-muted-foreground" />
      <path d={ring(452, 200, 4)} className="fill-muted-foreground" />
      {props.pins.map((place) => {
        const { pin, line } = BIKE_SPOTS[place];
        const lit = place === props.lit;
        return (
          <g key={place} data-pin={place}>
            {props.lines && (
              <path
                d={`M${line[0]} ${line[1]} L${pin[0]} ${pin[1]}`}
                strokeWidth={1.5}
                className={lit ? "stroke-primary-text" : "stroke-foreground/30"}
              />
            )}
            <circle
              cx={pin[0]}
              cy={pin[1]}
              r={lit ? 6 : 4}
              strokeWidth={2}
              className={classes("stroke-card", lit ? "fill-primary-text" : "fill-foreground/90")}
            />
          </g>
        );
      })}
    </svg>
  );
}
