import type {
  HomeView,
  PinnedPart,
  ThingSlug,
  ThingSummary,
  WorkspaceId,
} from "@courtyard/contract";
import { useState } from "react";
import { RowButton } from "@/components/buttons/row-button";
import { PhotoWithPins } from "@/components/photo/photo-pins";
import { classes } from "@/lib/classes";
import { useLayout } from "../../components/frame/handheld.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { thingPhotoUrl } from "../things/api.ts";
import { movePin } from "./api.ts";
import { fittedOf, PartCard } from "./part-card.tsx";

type Breakdown = Extract<HomeView, { kind: "picture" }>;

/**
 * A Thing broken down part by part (#565; Paper, "Tablet · Planning Home: the bike, part by part
 * (#565)" and its Desktop and Cover boards): its photo with every part pinned, and from a tablet
 * up each part's label beside it with a line to its pin; on the cover screen the pins alone, with
 * every part in a list under it. A tap on a label, a pin or a row chooses the part and opens its
 * card at the view's foot, in a place kept for it. A part with no pin yet is labelled too: chosen,
 * a tap on the photo places it. Calm: what a part needs waits in its card, a gold dot its only
 * mark.
 */
export function BreakdownView(props: {
  workspaceId: WorkspaceId;
  view: Breakdown;
  /** Every Thing, for the photo's address and each part's details. */
  things: readonly ThingSummary[];
  /** Opens the box with these words, to start a session. */
  ask: (text: string) => void;
  /** Once a pin moved or a part was marked: Home loads again. */
  changed: () => Promise<void>;
}) {
  const { workspaceId, view } = props;
  const cover = useLayout() === "cover";
  const [chosen, setChosen] = useState<ThingSlug>();
  const [problem, setProblem] = useState<string>();

  const thingOf = (slug: ThingSlug) => props.things.find((thing) => thing.slug === slug);
  const open = view.parts.find((part) => part.thing === chosen);
  const placing = open?.pin === null ? open : undefined;
  const top = thingOf(view.thing);
  // The photo's address changes only with its own Thing, so moving a pin never loads it again.
  const src =
    top === undefined
      ? `/api/workspaces/${encodeURIComponent(workspaceId)}/things/${view.thing}/photo`
      : thingPhotoUrl(workspaceId, top);
  const choose = (part: ThingSlug) => setChosen((was) => (was === part ? undefined : part));

  const photo = (
    <PhotoWithPins
      src={src}
      alt={`Photo of ${view.title}`}
      parts={view.parts}
      chosen={chosen}
      choose={choose}
      {...(placing === undefined ? {} : { placing: placing.thing })}
      labelled={!cover}
      move={async (part, pin) => {
        const moved = await movePin(workspaceId, part, pin);
        if (moved.kind !== "loaded") {
          setProblem(describeProblem(moved).body);
          return false;
        }
        setProblem(undefined);
        await props.changed();
        return true;
      }}
      className={cover ? "h-56 w-full shrink-0 rounded-row" : "min-h-0 grow"}
    />
  );

  return (
    <section
      aria-label={view.title}
      className={classes("flex flex-col gap-3", !cover && "min-h-0 grow")}
    >
      {photo}
      {/* From a tablet up the card's place is kept, so opening one never moves the photo (#283). */}
      <div className={classes("flex shrink-0 flex-col justify-center gap-1", !cover && "h-27")}>
        {problem !== undefined && (
          <p role="alert" className="text-center text-meta text-destructive-text">
            {problem}
          </p>
        )}
        {open !== undefined ? (
          <PartCard
            key={open.thing}
            workspaceId={workspaceId}
            part={open}
            thing={thingOf(open.thing)}
            placing={placing !== undefined}
            ask={() => props.ask(`About the ${open.name} on the ${view.title}: `)}
            onDone={props.changed}
          />
        ) : (
          !cover && (
            <p className="text-center text-meta font-medium text-muted-foreground">
              Tap a part for what's fitted · drag a pin to move it
            </p>
          )
        )}
      </div>
      {cover && (
        <ul aria-label="Parts" className="flex flex-col divide-y">
          {view.parts.map((part) => (
            <li key={part.thing}>
              <PartRow
                part={part}
                fitted={fittedOf(thingOf(part.thing))}
                chosen={part.thing === chosen}
                choose={choose}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A part's row on the cover screen: its name, with a gold dot when it needs something, and what's fitted. */
function PartRow(props: {
  part: PinnedPart;
  fitted: string;
  chosen: boolean;
  choose: (part: ThingSlug) => void;
}) {
  const { part } = props;
  return (
    <RowButton chosen={props.chosen} compact onClick={() => props.choose(part.thing)}>
      <span className="flex min-w-0 grow items-center gap-2 text-interface font-semibold text-foreground">
        {part.flagged && <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />}
        {part.name}
      </span>
      <span className="min-w-0 truncate text-meta text-muted-foreground">{props.fitted}</span>
    </RowButton>
  );
}
