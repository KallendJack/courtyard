import type { ThingSlug, ThingStatus, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import { classes } from "@/lib/classes";
import { thingPhotoUrl } from "./api.ts";
import { STATUS_WORDS, thingLine } from "./words.ts";

const STATUS_COLOURS: Readonly<Record<ThingStatus, string>> = {
  have: "text-muted-foreground",
  want: "text-primary-text",
  replace: "text-replace",
};

/** A Thing's status as a small chip: have in grey, want in heather, replace in bracken. */
export function StatusChip(props: { status: ThingStatus; large?: boolean }) {
  return (
    <span
      className={classes(
        "shrink-0 rounded-full bg-muted font-semibold",
        props.large ? "px-3 py-1 text-xs/4" : "px-2.5 py-[3px] text-xs/4 md:text-[12px]/4",
        STATUS_COLOURS[props.status],
      )}
    >
      {STATUS_WORDS[props.status]}
    </span>
  );
}

const PHOTO_SIZES = {
  /** A Thing's row. */
  row: "size-12 rounded-[8px] [&_svg]:size-[18px]",
  /** A part's row, under its Thing. */
  part: "size-9 rounded-[6px] [&_svg]:size-4",
  /** A Thing's card: the width of a phone, a square beside the details from tablet width. */
  card: "h-60 w-full rounded-[12px] md:size-55 [&_svg]:size-8",
} as const;

/** A Thing's photo, or a plain tag where it has none. */
export function ThingPhoto(props: {
  workspaceId: WorkspaceId;
  thing: ThingSummary;
  size: keyof typeof PHOTO_SIZES;
}) {
  const { thing, size } = props;
  const box = classes("shrink-0", PHOTO_SIZES[size]);
  if (!thing.photo) {
    return (
      <span aria-hidden className={classes(box, "flex items-center justify-center bg-muted")}>
        <Tag className="text-placeholder" />
      </span>
    );
  }
  return (
    <img
      src={thingPhotoUrl(props.workspaceId, thing)}
      alt={size === "card" ? `Photo of ${thing.name}` : ""}
      className={classes(box, "bg-muted object-cover")}
    />
  );
}

/** One Thing as a row, opening its card: its photo, name, details and status. */
function ThingRow(props: {
  workspaceId: WorkspaceId;
  thing: ThingSummary;
  part: boolean;
  /** The name of the Thing it's part of, when that isn't shown above it. */
  partOf: string | undefined;
}) {
  const { workspaceId, thing, part } = props;
  const line = thingLine(thing, props.partOf);
  return (
    <Link
      to="/workspaces/$workspaceId/things/$slug"
      params={{ workspaceId, slug: thing.slug }}
      className={classes(
        "-mx-2 flex items-center rounded-md px-2 hover:bg-muted/60",
        part ? "gap-3 py-2" : "gap-3.5 py-3",
      )}
    >
      <ThingPhoto workspaceId={workspaceId} thing={thing} size={part ? "part" : "row"} />
      <span className={classes("flex min-w-0 grow flex-col", !part && "gap-0.5")}>
        <span
          className={classes("truncate font-medium", part ? "text-[15px]/5" : "text-base/[22px]")}
        >
          {thing.name}
        </span>
        {line !== "" && (
          <span className="truncate text-xs/[18px] text-muted-foreground">{line}</span>
        )}
      </span>
      <span className="flex w-18 shrink-0 justify-end md:w-21">
        <StatusChip status={thing.status} />
      </span>
    </Link>
  );
}

/**
 * Things as rows (ADR 0020), each part under the Thing it's part of behind a thin line, in the
 * order given. A part whose Thing isn't among them (a filter left it out) is a row of its own,
 * saying what it's part of.
 */
export function ThingRows(props: {
  workspaceId: WorkspaceId;
  /** The Things to show, each part straight after its Thing, as the worker lists them. */
  things: readonly ThingSummary[];
  /** Every Thing in the workspace, for the names of the Things parts belong to. */
  all: readonly ThingSummary[];
  /** The Thing these are parts of, on its own card, which they needn't name. */
  within?: ThingSlug;
  label: string;
}) {
  const { workspaceId, things, all } = props;
  const shown = new Set<string>(things.map((thing) => thing.slug));
  if (props.within !== undefined) shown.add(props.within);
  const nameOf = (slug: string) => all.find((thing) => thing.slug === slug)?.name;
  const top = things.filter(
    (thing) =>
      thing.partOf === undefined || thing.partOf === props.within || !shown.has(thing.partOf),
  );
  return (
    <ul aria-label={props.label}>
      {top.map((thing) => {
        const parts = things.filter((part) => part.partOf === thing.slug);
        return (
          <li key={thing.slug} className="border-t">
            <ThingRow
              workspaceId={workspaceId}
              thing={thing}
              part={false}
              partOf={
                thing.partOf === undefined || shown.has(thing.partOf)
                  ? undefined
                  : nameOf(thing.partOf)
              }
            />
            {parts.length > 0 && (
              <div className="pb-2 pl-[23px]">
                <ul aria-label={`Parts of ${thing.name}`} className="border-l-[1.5px] pl-6">
                  {parts.map((part) => (
                    <li key={part.slug}>
                      <ThingRow workspaceId={workspaceId} thing={part} part partOf={undefined} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
