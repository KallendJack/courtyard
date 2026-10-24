import type { BikePlace, DrawnPart, HomeSubject, WorkspaceId } from "@courtyard/contract";
import { useLayout } from "@courtyard/ui/frame/handheld.ts";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useRef, useState } from "react";
import { useLabelsApart } from "@/components/drawings/labels-apart";
import {
  BIKE_HEIGHT,
  BIKE_SPOTS,
  BIKE_WIDTH,
  MountainBike,
} from "@/components/drawings/mountain-bike";
import {
  DrawingPlace,
  FencedBlock,
  fencedKind,
  OnHome,
} from "../../components/rich-blocks/fenced.tsx";
import { DrawSpace } from "./draw-space.tsx";

/** A floor plan is drawn as in an answer, by its rich block, loaded only when Home has one. */
const PLAN = fencedKind("plan");

/** A house's floors are drawn by the plan's own module, loaded only when Home has them (#670). */
const Floors = lazy(() =>
  import("../../components/rich-blocks/floor-plan.tsx").then(({ Floors }) => ({ default: Floors })),
);

/**
 * A planning workspace's main subject, leading its Home (#603; Paper, "Tablet · Mountain biking
 * Home: the bike, then projects (#603)"): the drawn bike, its parts placed on it by name, or a
 * room's floor plan (#257), or a house's floors side by side (#670). One panel, keeping its size;
 * with no subject, one quiet line in it.
 * A space with no plan yet is Draw the garage's card instead (#604).
 */
export function HomeSubjectBlock(props: { workspaceId: WorkspaceId; subject: HomeSubject | null }) {
  const { subject } = props;
  // A space with no plan yet: its own card, as tall as it needs (#604).
  if (subject?.kind === "space") {
    return <DrawSpace workspaceId={props.workspaceId} space={subject} />;
  }
  return (
    <div className="flex min-h-80 flex-col gap-2.5 rounded-card border bg-surface px-3.5 py-3 md:min-h-0 md:grow">
      {subject === null ? (
        <div className="flex grow items-center justify-center">
          <p className="max-w-80 text-center text-body text-muted-foreground">
            A bike and its parts, or a room's floor plan, shows here.
          </p>
        </div>
      ) : subject.kind === "plan" ? (
        PLAN !== undefined && (
          <OnHome value={true}>
            <FencedBlock
              key={subject.document}
              kind={PLAN}
              language="plan"
              source={JSON.stringify(subject.plan)}
            />
          </OnHome>
        )
      ) : subject.kind === "floors" ? (
        <Suspense fallback={<DrawingPlace />}>
          <Floors name={subject.name} floors={subject.floors} />
        </Suspense>
      ) : (
        <DrawnBike workspaceId={props.workspaceId} subject={subject} />
      )}
    </div>
  );
}

type Drawing = Extract<HomeSubject, { kind: "drawing" }>;

/**
 * The drawn bike (#603): Courtyard's drawing of a mountain bike, each of the Thing's parts on its
 * place by name, a label each that opens its card, one with an upcoming replacement a quiet dot.
 * Parts it has no place for are listed under it, as labels too. From a tablet up the labels sit
 * round the bike, each with a line to its pin, the drawing as big as the panel lets it be; on the
 * cover screen the bike has its pins only, and every part is listed under it.
 */
function DrawnBike(props: { workspaceId: WorkspaceId; subject: Drawing }) {
  const { subject } = props;
  const cover = useLayout() === "cover";
  /** The place whose label is pointed at or focused, lit on the bike. */
  const [lit, setLit] = useState<BikePlace>();
  const room = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  // Labels that would overlap on a small bike are pushed apart along their row (#657).
  const shifts = useLabelsApart({
    room,
    drawing,
    width: BIKE_WIDTH,
    spots: BIKE_SPOTS,
    keys: subject.placed.map(({ place }) => place),
    on: !cover,
  });
  const label = (part: DrawnPart, place?: BikePlace) => (
    <PartLabel
      key={part.thing}
      workspaceId={props.workspaceId}
      part={part}
      {...(place === undefined
        ? {}
        : {
            light: (on: boolean) => setLit((was) => (on ? place : was === place ? undefined : was)),
          })}
    />
  );
  /** The parts listed under the bike, with their places: on the cover screen, all of them. */
  const listed: readonly { part: DrawnPart; place?: BikePlace }[] = [
    ...(cover ? subject.placed.map((part) => ({ part, place: part.place })) : []),
    ...subject.unplaced.map((part) => ({ part })),
  ];

  return (
    <section
      aria-label={subject.name}
      className={classes("flex flex-col gap-2.5", !cover && "min-h-0 grow")}
    >
      {/* From a tablet up the panel's room is measured as a container, so the bike is as big as fits. */}
      <div
        ref={room}
        className={classes("relative", !cover && "min-h-0 grow [container-type:size]")}
      >
        <div
          ref={drawing}
          className={classes(
            "aspect-[622/300]",
            cover
              ? "relative w-full"
              : "absolute inset-0 m-auto h-[min(100cqh,calc(100cqw*300/622))] w-[min(100cqw,calc(100cqh*622/300))]",
          )}
        >
          <MountainBike
            pins={subject.placed.map(({ place }) => place)}
            lit={lit}
            lines={!cover}
            shifts={shifts}
            label={`Drawing of ${subject.name}`}
          />
          {!cover &&
            subject.placed.map((part) => {
              const [x, y] = BIKE_SPOTS[part.place].label;
              const [dx, dy] = shifts[part.place] ?? [0, 0];
              return (
                <div
                  key={part.thing}
                  data-label={part.place}
                  className="absolute w-max"
                  style={{
                    left: `${((x + dx) / BIKE_WIDTH) * 100}%`,
                    top: `${((y + dy) / BIKE_HEIGHT) * 100}%`,
                  }}
                >
                  {label(part, part.place)}
                </div>
              );
            })}
        </div>
      </div>
      {listed.length > 0 && (
        <ul aria-label="Parts" className="flex shrink-0 flex-wrap justify-center gap-2">
          {listed.map(({ part, place }) => (
            <li key={part.thing}>{label(part, place)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A part's label on the drawn bike, which opens its card: its name, and a quiet violet dot when it
 * has an upcoming replacement (#664). The replacement's name waits on the card, one tap away; the
 * label's name still says it ("Pedals, DMR V8 next").
 */
function PartLabel(props: {
  workspaceId: WorkspaceId;
  part: DrawnPart;
  /** Lights its place on the bike while it's pointed at or focused. */
  light?: (on: boolean) => void;
}) {
  const { part, light } = props;
  return (
    <Link
      to="/workspaces/$workspaceId/things/$slug"
      params={{ workspaceId: props.workspaceId, slug: part.thing }}
      onPointerEnter={() => light?.(true)}
      onPointerLeave={() => light?.(false)}
      onFocus={() => light?.(true)}
      onBlur={() => light?.(false)}
      {...(part.upcoming === undefined
        ? {}
        : { "aria-label": `${part.name}, ${part.upcoming} next` })}
      className="flex h-6.5 max-w-56 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-meta font-semibold whitespace-nowrap text-foreground/90 inset-ring inset-ring-input outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="truncate">{part.name}</span>
      {part.upcoming !== undefined && (
        <span aria-hidden="true" className="size-1.75 shrink-0 rounded-full bg-primary-text" />
      )}
    </Link>
  );
}
