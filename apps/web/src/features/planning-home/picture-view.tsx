import type { HomeView, ThingSlug, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { useState } from "react";
import { RowButton } from "@/components/buttons/row-button";
import { type NumberedPart, PhotoWithPins } from "@/components/photo/photo-pins";
import { classes } from "@/lib/classes";
import { useLayout, useWide } from "../../components/frame/handheld.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { thingPhotoUrl } from "../things/api.ts";
import { movePin } from "./api.ts";
import { needsLine, PartCard } from "./part-card.tsx";

type Picture = Extract<HomeView, { kind: "picture" }>;

/**
 * A Thing's photo with its parts pinned (#481; Paper, "Tablet · Home: the bike, parts pinned" and
 * its Desktop and Cover boards): beside it on a tablet, under it on the cover screen, only what
 * needs doing, numbered as its pin is; never background (#220). A tap on a pin or a row opens its
 * part's card: beside them on a wide screen, over the page otherwise.
 */
export function PictureView(props: {
  workspaceId: WorkspaceId;
  view: Picture;
  /** Every Thing, for the photo's address and each part's details. */
  things: readonly ThingSummary[];
  /** Once a pin moved or a part was marked: Home loads again. */
  changed: () => Promise<void>;
}) {
  const { workspaceId, view } = props;
  const cover = useLayout() === "cover";
  const wide = useWide();
  const [chosen, setChosen] = useState<ThingSlug>();
  const [problem, setProblem] = useState<string>();

  let flagged = 0;
  const parts: NumberedPart[] = view.parts.map((part) => ({
    ...part,
    number: part.flagged ? ++flagged : undefined,
  }));
  const needing = parts.filter((part) => part.number !== undefined);
  const open = parts.find((part) => part.thing === chosen);
  const top = props.things.find((thing) => thing.slug === view.thing);
  // The photo's address changes only with its own Thing, so moving a pin never loads it again.
  const src =
    top === undefined
      ? `/api/workspaces/${encodeURIComponent(workspaceId)}/things/${view.thing}/photo`
      : thingPhotoUrl(workspaceId, top);
  const choose = (part: ThingSlug) => setChosen((was) => (was === part ? undefined : part));

  const card = open !== undefined && (
    <PartCard
      key={open.thing}
      workspaceId={workspaceId}
      part={open}
      thing={props.things.find((thing) => thing.slug === open.thing)}
      of={view.title}
      beside={wide && !cover}
      onClose={() => setChosen(undefined)}
      onMarked={async (mark) => {
        await props.changed();
        if (mark === "done") setChosen(undefined);
      }}
    />
  );

  return (
    <section
      aria-label={view.title}
      className={classes("flex gap-4.5", cover ? "flex-col" : "min-h-0 grow")}
    >
      <PhotoWithPins
        src={src}
        alt={`Photo of ${view.title}`}
        parts={parts}
        chosen={chosen}
        choose={choose}
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
        className={
          cover ? "h-56 w-full rounded-row" : "aspect-3/4 h-full max-h-110 shrink-0 rounded-row"
        }
      />
      <div className={classes("flex min-w-0 flex-col gap-1.5", !cover && "grow pt-1")}>
        {needing.length > 0 && (
          <ul aria-label="What needs doing" className="flex flex-col gap-1.5">
            {needing.map((part) => (
              <li key={part.thing}>
                <PartRow part={part} chosen={part.thing === chosen} cover={cover} choose={choose} />
              </li>
            ))}
          </ul>
        )}
        <div className="grow" />
        {problem !== undefined ? (
          <p role="alert" className="pl-3 text-meta text-destructive-text">
            {problem}
          </p>
        ) : (
          !cover && (
            <p className="pl-3 text-meta font-medium text-muted-foreground">
              Tap a pin for its card · drag one to move it
            </p>
          )
        )}
      </div>
      {card}
    </section>
  );
}

/** A flagged part's row: its number, its name, and what it needs. */
function PartRow(props: {
  part: NumberedPart;
  chosen: boolean;
  cover: boolean;
  choose: (part: ThingSlug) => void;
}) {
  const { part } = props;
  return (
    <RowButton chosen={props.chosen} compact={props.cover} onClick={() => props.choose(part.thing)}>
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-warning text-label font-extrabold text-card"
      >
        {part.number}
      </span>
      <span
        className={classes(
          "flex min-w-0 grow",
          props.cover ? "flex-row items-baseline gap-4" : "flex-col gap-0.5",
        )}
      >
        <span
          className={classes(
            "text-interface",
            props.cover && "w-24 shrink-0",
            props.chosen ? "font-bold text-foreground" : "font-semibold text-foreground/90",
          )}
        >
          {part.name}
        </span>
        <span className="min-w-0 text-meta font-medium text-muted-foreground">
          {needsLine(part)}
        </span>
      </span>
    </RowButton>
  );
}
