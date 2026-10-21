import { FloorPlan, type PlanItem, type PlanWall, WorkspaceId } from "@courtyard/contract";
import { Link, useParams } from "@tanstack/react-router";
import { PanelsTopLeft } from "lucide-react";
import { type KeyboardEvent, use, useLayoutEffect, useMemo, useState } from "react";
import { RowButton } from "@/components/buttons/row-button";
import { useBlocksFill } from "@/components/frame/handheld";
import { CapsLabel } from "@/components/layout/caps-label";
import { useKept } from "@/components/layout/kept";
import { Scroller } from "@/components/layout/scroller";
import { classes } from "@/lib/classes";
import { KEPT_HOME, loadKeptHome } from "../../features/planning-home/api.ts";
import { type DrawingProps, OnHome } from "./fenced.tsx";
import {
  type Box,
  type Edge,
  type Layout,
  layoutOf,
  metres,
  PAD,
  runsAround,
  SIDES,
  sideName,
  sideOf,
  sizeOf,
  wallRuns,
} from "./plan-geometry.ts";
import { RichBlock } from "./rich-block.tsx";

/** The plan's JSON, when it's a plan Courtyard can draw. */
const planFrom = (source: string) => {
  try {
    const parsed = FloorPlan.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The most room a plan takes, in pixels: in an answer, and in Home's block on the cover screen,
 * where the block grows with it. From a tablet up, Home's block has the height the layout gives
 * it, and the plan is drawn as big as fits in it (#662).
 */
const FIT = { width: 300, height: 400 };
const FIT_ON_HOME = { width: 280, height: 340 };

/** What's kept beside the drawing on Home for its list: the list's least width and the gap. */
const LIST_ROOM = 224 + 24;

/** The least room a plan is drawn in, so it's never drawn inside out: its room 40 px across. */
const LEAST = 2 * PAD + 40;

type Size = { width: number; height: number };

/**
 * The size of `element` while `on`, measured before it's painted and again whenever it changes
 * size, so the plan is drawn at its final size from the first frame (#283) and redrawn to fit as
 * the window changes.
 */
const useSizeOf = (element: HTMLElement | null, on: boolean) => {
  const [size, setSize] = useState<Size>();
  useLayoutEffect(() => {
    if (!on || element === null) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((was) => (was?.width === width && was.height === height ? was : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, on]);
  return on ? size : undefined;
};

/** The room the drawing has beside the list in a row of `size`. */
const fitIn = (size: Size): Size => ({
  width: Math.max(LEAST, size.width - LIST_ROOM),
  height: Math.max(LEAST, size.height),
});

/** How thick the walls are drawn, the inner walls, and a strip for a thing on a wall, in pixels. */
const WALL = 4;
const PARTITION = 3;
const STRIP = 7;

/**
 * A `plan` block (#257; Paper, "Tablet · Floor plan in an answer (#257)" and its Cover board): a
 * room drawn top-down and to scale from the model's JSON, seen from the front of the house with
 * the front at the bottom, its doors, windows, zones and measured sizes on it (#661: only what was
 * given, a thing with no size a dot where it is); what you have solid and what
 * you want dashed. Beside it on a wide screen, under it on a narrow one, what's in it by side: a
 * tap on a thing or its row lights both up in violet and shows its size and why it's there. In an
 * answer it says once it's on the workspace's Home, where the worker saved it. JSON that isn't a
 * plan shows the fallback.
 */
export default function FloorPlanBlock(props: DrawingProps) {
  const plan = useMemo(() => planFrom(props.source), [props.source]);
  const onHome = use(OnHome);
  const [chosen, setChosen] = useState<number>();
  // From a tablet up, on Home, the plan fills its block: drawn whole to fit the row it's in.
  const fills = useBlocksFill() && onHome;
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const room = useSizeOf(row, fills);
  if (plan === undefined) return props.fallback;
  const choose = (index: number) => setChosen((was) => (was === index ? undefined : index));
  const name = `${plan.room} floor plan`;

  const list = <ThingsList plan={plan} chosen={chosen} choose={choose} />;
  return (
    <RichBlock fill={fills}>
      <figure
        aria-label={name}
        className={classes(
          "flex flex-col gap-3",
          onHome ? "min-h-0 grow" : "rounded-card border bg-field p-4 md:p-5",
        )}
      >
        <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CapsLabel tone="muted" inline className="flex items-center gap-2">
            <PanelsTopLeft aria-hidden className="size-3.5 text-primary-text" />
            Plan · {plan.room}
            {plan.measured === true &&
              ` · ${(plan.depth / 100).toFixed(1)} × ${metres(plan.width)}`}
          </CapsLabel>
          <span className="flex items-center gap-3">
            <Legend />
            {!onHome && !props.arriving && <SavedOnHome plan={plan} />}
          </span>
        </figcaption>
        {plan.turned !== undefined && (
          <p className="text-meta text-muted-foreground">
            Turned {plan.turned.to === "around" ? "around" : `to the ${plan.turned.to}`}:{" "}
            {plan.turned.why}
          </p>
        )}
        <div
          ref={setRow}
          className={classes(
            "flex flex-wrap items-start gap-x-6 gap-y-4",
            onHome && "min-h-0 grow md:flex-nowrap",
          )}
        >
          <Drawing
            plan={plan}
            layout={layoutOf(plan, room !== undefined ? fitIn(room) : onHome ? FIT_ON_HOME : FIT)}
            chosen={chosen}
            choose={choose}
          />
          {onHome ? (
            <Scroller from="tablet" fadeEnd className="min-w-56 basis-64 grow md:h-full">
              {list}
            </Scroller>
          ) : (
            list
          )}
        </div>
      </figure>
    </RichBlock>
  );
}

/** Have and want, as they're drawn. */
function Legend() {
  return (
    <span className="flex items-center gap-3 text-meta text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2.5 w-3.5 rounded-sm border border-muted-foreground bg-muted"
        />
        Have
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2.5 w-3.5 rounded-sm border border-dashed border-muted-foreground"
        />
        Want
      </span>
    </span>
  );
}

/**
 * "On Home ✓", once the workspace's Home shows this very plan as its main subject: the worker saved
 * it when the answer ended (#257, #603). It opens Home. Nothing where there's no Home, or once a
 * later plan has replaced it.
 */
function SavedOnHome(props: { plan: FloorPlan }) {
  const params = useParams({ strict: false });
  const named = WorkspaceId.safeParse(params.workspaceId);
  const workspaceId = named.success ? named.data : undefined;
  const home = useKept(KEPT_HOME, {
    key: workspaceId ?? "",
    asking: workspaceId !== undefined,
    load: async () => (workspaceId === undefined ? undefined : loadKeptHome(workspaceId)),
  });
  const drawn = JSON.stringify(props.plan);
  const subject = home?.subject;
  const saved = subject?.kind === "plan" && JSON.stringify(subject.plan) === drawn;
  if (workspaceId === undefined || saved !== true) return null;
  return (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId }}
      className="flex h-8 items-center rounded-full border px-3 text-meta font-semibold text-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      On Home ✓
    </Link>
  );
}

type Drawn = {
  plan: FloorPlan;
  layout: Layout;
  chosen: number | undefined;
  choose: (index: number) => void;
};

/** The room to scale: its floor, things, inner walls, walls with their gaps, and what's outside. */
function Drawing(props: Drawn) {
  const { plan, layout } = props;
  const { room } = layout;
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const whole = useWhole(svg, layout);
  return (
    // A group rather than an image, so the things on it stay buttons a screen reader can tap.
    // biome-ignore lint/a11y/useSemanticElements: a drawing can't be a <fieldset>
    <svg
      ref={setSvg}
      role="group"
      aria-label={
        plan.measured === true
          ? `${plan.room}, ${metres(plan.width)} wide and ${metres(plan.depth)} deep, seen from the front`
          : `${plan.room}, seen from the front`
      }
      width={whole.width}
      height={whole.height}
      viewBox={`${whole.x} ${whole.y} ${whole.width} ${whole.height}`}
      className="block h-auto max-w-full shrink-0 font-sans text-caption select-none"
    >
      <rect data-plan-part="room" {...room} className="fill-surface" />
      {zonesOf(plan, layout).map(({ box }, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: zones are in the model's order
          key={index}
          {...box}
          fill="none"
          strokeDasharray="3 4"
          className="stroke-muted-foreground/30"
        />
      ))}
      <Things {...props} />
      <Partitions plan={plan} layout={layout} />
      <Walls plan={plan} layout={layout} />
      {/* Over what's in the room, ringed in the floor's colour, so a name stays readable. */}
      {zonesOf(plan, layout).map(({ name, box }, index) => (
        <text
          // biome-ignore lint/suspicious/noArrayIndexKey: zones are in the model's order
          key={index}
          data-plan-part="zone"
          x={box.x + box.width / 2}
          y={box.y + box.height / 2 + 4}
          textAnchor="middle"
          strokeWidth={4}
          paintOrder="stroke"
          className="pointer-events-none fill-muted-foreground stroke-surface text-label font-medium"
        >
          {name}
        </text>
      ))}
      <Outside plan={plan} layout={layout} />
    </svg>
  );
}

/** Room left round words that reach past the layout's edge, in pixels. */
const MARGIN = 2;

/**
 * The box a drawing is shown in: its layout's, widened to take in whatever is drawn past it, as
 * the front's words are under a narrow room, so nothing is cut off at its edge (#662). Measured
 * before it's painted, so nothing moves.
 */
const useWhole = (svg: SVGSVGElement | null, layout: Layout): Box => {
  const [drawn, setDrawn] = useState<Box>();
  useLayoutEffect(() => {
    if (svg === null) return;
    const { x, y, width, height } = svg.getBBox();
    setDrawn((was) =>
      was?.x === x && was.y === y && was.width === width && was.height === height
        ? was
        : { x, y, width, height },
    );
  });
  if (drawn === undefined) return { x: 0, y: 0, width: layout.width, height: layout.height };
  const left = Math.min(0, drawn.x - MARGIN);
  const top = Math.min(0, drawn.y - MARGIN);
  const right = Math.max(layout.width, drawn.x + drawn.width + MARGIN);
  const bottom = Math.max(layout.height, drawn.y + drawn.height + MARGIN);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Each zone's name and where it's drawn. */
const zonesOf = (plan: FloorPlan, layout: Layout) =>
  (plan.zones ?? []).map((zone) => ({
    name: zone.name,
    box: layout.box(zone.fromLeft, zone.fromBack, zone.width, zone.depth),
  }));

/**
 * Each thing in the room: a box or round on the floor, a strip on a wall, or a dot where it is when
 * no size was given (#661); tapping one chooses it.
 */
function Things(props: Drawn) {
  const { plan, layout } = props;
  return (plan.items ?? []).map((item, index) => {
    const chosen = props.chosen === index;
    const wants = item.status === "want";
    const box = boxOf(layout, item);
    const look = classes(
      chosen
        ? "fill-primary/30 stroke-primary"
        : wants
          ? "fill-none stroke-muted-foreground"
          : "fill-muted stroke-muted-foreground/70",
    );
    const shape = {
      strokeWidth: chosen ? 2 : 1.25,
      ...(wants ? { strokeDasharray: "4 3" } : {}),
      className: look,
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      props.choose(index);
    };
    return (
      // A thing on the plan is tapped like its row in the list, which is a real button.
      // biome-ignore lint/a11y/useSemanticElements: an SVG shape can't be a <button>
      <g
        // biome-ignore lint/suspicious/noArrayIndexKey: things are in the model's order, and may share a name
        key={index}
        role="button"
        tabIndex={0}
        aria-label={item.name}
        aria-pressed={chosen}
        data-status={wants ? "want" : "have"}
        data-chosen={chosen ? "" : undefined}
        onClick={() => props.choose(index)}
        onKeyDown={onKeyDown}
        className="cursor-pointer outline-none focus-visible:[&>*]:stroke-ring"
      >
        <title>{item.name}</title>
        {box === undefined ? (
          <circle {...dotOf(layout, item)} {...shape} />
        ) : "wall" in item || item.round !== true ? (
          <rect {...box} rx={2} {...shape} />
        ) : (
          <ellipse
            cx={box.x + box.width / 2}
            cy={box.y + box.height / 2}
            rx={box.width / 2}
            ry={box.height / 2}
            {...shape}
          />
        )}
      </g>
    );
  });
}

/** Where a thing is drawn to its size: none when its size wasn't given. */
const boxOf = (layout: Layout, item: PlanItem) => {
  if ("wall" in item) {
    const { length } = item;
    return length === undefined ? undefined : layout.stripOn({ ...item, length }, STRIP);
  }
  const { width, depth } = item;
  return width === undefined || depth === undefined
    ? undefined
    : layout.box(item.fromLeft, item.fromBack, width, depth);
};

/** How big a thing with no size is drawn, in pixels round: a dot, the same at any scale. */
const DOT = 5;

/** A thing with no size as a dot, clear of the walls. */
const dotOf = (layout: Layout, item: PlanItem) => {
  const { x, y } = layout.dotAt(item, DOT + WALL / 2);
  return { cx: x, cy: y, r: DOT };
};

/** The walls inside the room, with their doorways. */
function Partitions(props: { plan: FloorPlan; layout: Layout }) {
  const { plan, layout } = props;
  return (plan.partitions ?? []).map((wall, index) => {
    const across = wall.fromBack !== undefined;
    const at = wall.fromBack ?? wall.fromLeft ?? 0;
    const runs = runsAround(
      wall.start ?? 0,
      wall.end ?? (across ? plan.width : plan.depth),
      wall.doorway === undefined ? [] : [wall.doorway],
    );
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: inner walls are in the model's order
      <g key={index} data-plan-part="partition">
        {runs.map(([from, to]) => {
          const a = across ? layout.point(from, at) : layout.point(at, from);
          const b = across ? layout.point(to, at) : layout.point(at, to);
          return (
            <line
              key={from}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={PARTITION}
              strokeLinecap="square"
              className="stroke-muted-foreground"
            />
          );
        })}
      </g>
    );
  });
}

/** The four walls, gapped for their doors and windows, and each opening drawn as what it is. */
function Walls(props: { plan: FloorPlan; layout: Layout }) {
  const { plan, layout } = props;
  const walls: readonly PlanWall[] = ["back", "right", "front", "left"];
  return (
    <>
      {walls.flatMap((wall) =>
        wallRuns(plan, wall).map(([from, to]) => {
          const a = layout.onWall(wall, from);
          const b = layout.onWall(wall, to);
          return (
            <line
              key={`${wall}-${from}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={WALL}
              strokeLinecap="square"
              className="stroke-muted-foreground"
            />
          );
        }),
      )}
      {(plan.openings ?? []).map((opening, index) => {
        const a = layout.onWall(opening.wall, opening.at);
        const b = layout.onWall(opening.wall, opening.at + opening.width);
        const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: openings are in the model's order
          <g key={index} data-plan-part="opening">
            {opening.name !== undefined && <title>{opening.name}</title>}
            {opening.kind === "door" ? (
              <path
                d={layout.doorPath(opening)}
                fill="none"
                strokeWidth={1.25}
                className="stroke-muted-foreground"
              />
            ) : opening.kind === "window" ? (
              <>
                <line {...line} strokeWidth={WALL} className="stroke-surface" />
                <line
                  {...line}
                  strokeWidth={WALL}
                  strokeOpacity={0.5}
                  className="stroke-chart-slate"
                />
                <line {...line} strokeWidth={1} className="stroke-chart-slate" />
              </>
            ) : opening.kind === "garage-door" ? (
              <line
                {...line}
                strokeWidth={2}
                strokeDasharray="5 4"
                className="stroke-muted-foreground"
              />
            ) : null}
          </g>
        );
      })}
    </>
  );
}

/** Where a label goes `away` pixels outside an edge of the room, and whether it's turned to read up it. */
const outsideAt = (layout: Layout, edge: Edge, away: number) => {
  const { room } = layout;
  const middleX = room.x + room.width / 2;
  const middleY = room.y + room.height / 2;
  return edge === "top"
    ? { x: middleX, y: room.y - away, upright: true }
    : edge === "bottom"
      ? { x: middleX, y: room.y + room.height + away, upright: true }
      : edge === "left"
        ? { x: room.x - away, y: middleY, upright: false }
        : { x: room.x + room.width + away, y: middleY, upright: false };
};

/** A line of text outside the room, upright, or turned to read along a side edge. */
function Label(props: {
  at: { x: number; y: number; upright: boolean };
  className: string;
  children: string;
}) {
  const { x, y, upright } = props.at;
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      transform={upright ? undefined : `rotate(-90 ${x} ${y})`}
      className={props.className}
    >
      {props.children}
    </text>
  );
}

/** Arrows from the front into the room, by the edge the front is drawn on. */
const INTO_THE_ROOM: Record<Edge, string> = { bottom: "▲", top: "▼", left: "▶", right: "◀" };

/**
 * What's outside the room: the front, marked, and what's beyond each wall, near it; its width
 * across the top and its depth down the right, each with its sizes, once they were measured (#661).
 */
function Outside(props: { plan: FloorPlan; layout: Layout }) {
  const { plan, layout } = props;
  const { room } = layout;
  const front = layout.edgeOf("front");
  const quiet = "fill-muted-foreground text-caption font-semibold tracking-label uppercase";
  const beyond = Object.entries(plan.beyond ?? {}).flatMap(([wall, words]) => {
    const parsed = SIDES.find((side) => side === wall);
    return parsed === undefined || parsed === "middle" || parsed === "front"
      ? []
      : [{ wall: parsed, words }];
  });
  // Across the screen and down it, whichever of the room's sides they are.
  const sideways = front === "left" || front === "right";
  const acrossCm = sideways ? plan.depth : plan.width;
  const downCm = sideways ? plan.width : plan.depth;
  const top = room.y - 30;
  const right = room.x + room.width + 30;
  return (
    <>
      <Label
        at={outsideAt(layout, front, 16)}
        className="fill-primary-text text-caption font-bold tracking-label uppercase"
      >
        {`${INTO_THE_ROOM[front]} Front${plan.front === undefined ? "" : ` · ${plan.front}`}`}
      </Label>
      {beyond.map(({ wall, words }) => (
        <Label key={wall} at={outsideAt(layout, layout.edgeOf(wall), 14)} className={quiet}>
          {words}
        </Label>
      ))}
      {plan.measured === true && (
        <>
          <g className="stroke-muted-foreground/60">
            <line x1={room.x} x2={room.x + room.width} y1={top} y2={top} />
            <line x1={room.x} x2={room.x} y1={top - 4} y2={top + 4} />
            <line x1={room.x + room.width} x2={room.x + room.width} y1={top - 4} y2={top + 4} />
            <line x1={right} x2={right} y1={room.y} y2={room.y + room.height} />
            <line x1={right - 4} x2={right + 4} y1={room.y} y2={room.y} />
            <line
              x1={right - 4}
              x2={right + 4}
              y1={room.y + room.height}
              y2={room.y + room.height}
            />
          </g>
          <Measure at={{ x: room.x + room.width / 2, y: top, upright: true }}>
            {metres(acrossCm)}
          </Measure>
          <Measure at={{ x: right, y: room.y + room.height / 2, upright: false }}>
            {metres(downCm)}
          </Measure>
        </>
      )}
    </>
  );
}

/** A size written over its measuring line, on a patch of the block's own colour. */
function Measure(props: { at: { x: number; y: number; upright: boolean }; children: string }) {
  const { x, y, upright } = props.at;
  const long = props.children.length * 6 + 8;
  return (
    <g transform={upright ? undefined : `rotate(-90 ${x} ${y})`}>
      <rect x={x - long / 2} y={y - 7} width={long} height={14} className="fill-field" />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-muted-foreground text-caption font-semibold"
      >
        {props.children}
      </text>
    </g>
  );
}

/** What's in the room, by the side it's on: a tap on a row chooses it, as on the plan. */
function ThingsList(props: {
  plan: FloorPlan;
  chosen: number | undefined;
  choose: (index: number) => void;
}) {
  const { plan } = props;
  const items = (plan.items ?? []).map((item, index) => ({
    item,
    index,
    side: sideOf(plan, item),
  }));
  const sides = SIDES.flatMap((side) => {
    const on = items.filter((each) => each.side === side);
    return on.length === 0 ? [] : [{ side, on }];
  });
  if (items.length === 0) return null;
  return (
    <ul
      aria-label={`What's in the ${plan.room.toLowerCase()}`}
      className="flex min-w-56 basis-64 grow flex-col gap-3"
    >
      {sides.map(({ side, on }) => (
        <li key={side} className="flex flex-col gap-1">
          <CapsLabel tone="muted" className="px-3">
            {sideName(plan, side)}
          </CapsLabel>
          <ul className="flex flex-col gap-0.5">
            {on.map(({ item, index }) => (
              <li key={index}>
                <ThingRow
                  item={item}
                  chosen={props.chosen === index}
                  choose={() => props.choose(index)}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** A thing's row: its name and size, and once chosen, why it's there. */
function ThingRow(props: { item: PlanItem; chosen: boolean; choose: () => void }) {
  const { item, chosen } = props;
  // A thing with no size given is listed without one (#661).
  const size = [item.status === "want" ? "want" : undefined, sizeOf(item)]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <RowButton chosen={chosen} compact onClick={props.choose}>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={classes(
              "text-interface",
              chosen ? "font-bold text-foreground" : "font-semibold text-foreground/90",
            )}
          >
            {item.name}
          </span>
          <span
            className={classes(
              "shrink-0 text-meta",
              chosen ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {size}
          </span>
        </span>
        {chosen && item.why !== undefined && (
          <span className="text-meta text-foreground/80">{item.why}</span>
        )}
      </span>
    </RowButton>
  );
}
