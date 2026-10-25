import type {
  Roadmap as RoadmapAnswer,
  RoadmapIssue,
  RoadmapMilestone,
  RoadmapState,
  WorkspaceId,
} from "@courtyard/contract";
import { WebLink } from "@courtyard/ui/buttons/web-link.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { RowButton } from "@/components/buttons/row-button";
import { Block, BlockEmpty, BlockRows } from "@/components/layout/home-block";
import { clockWords } from "@/lib/when";
import { loadRoadmap } from "./api.ts";
import { Unread } from "./next-up.tsx";

/** Each workspace's Roadmap as last known, for the tab's lifetime. */
const KEPT_ROADMAP = createKept<RoadmapAnswer>();

/** How many open issues an open milestone shows before the rest fold into one row. */
const SHOWN_OPEN = 6;

/** What each state says, and its dot (AGENTS.md: violet is live, gold needs the owner). */
const STATES = {
  building: { dot: "bg-primary", text: "text-primary-text" },
  ready: { dot: "border-stroke border-foreground/70", text: "text-foreground/80" },
  "to-grill": { dot: "bg-warning", text: "text-warning" },
  blocked: { dot: "bg-placeholder", text: "text-muted-foreground" },
  done: { dot: "bg-success", text: "text-success" },
} as const satisfies Record<RoadmapState["kind"], { dot: string; text: string }>;

/** A state in plain words: Building, Ready, To grill, After …, Done. */
const wordsFor = (state: RoadmapState) => {
  switch (state.kind) {
    case "building":
      return "Building";
    case "ready":
      return "Ready";
    case "to-grill":
      return "To grill";
    case "blocked":
      return `After ${state.after}`;
    case "done":
      return "Done";
  }
};

/** How many of a milestone's issues are done, and how many in all. */
const progressOf = (milestone: RoadmapMilestone) => {
  const done = milestone.issues.filter((issue) => issue.state.kind === "done").length;
  return { done, all: milestone.issues.length, left: milestone.issues.length - done };
};

/**
 * A code workspace's Roadmap (#532; Paper, "Tablet · Roadmap", "Cover · Roadmap"): every open
 * milestone in the roadmap's order, one row each with its progress (done of all) and how many are
 * left, Later last. The current one (the first with open issues) is open, the others folded until
 * tapped. Inside, its issues in its Build order, each with one plain state the worker worked out;
 * past the first few open ones, the rest and the done ones fold into one row. Tapping an issue
 * opens its summary and its boards. Read-only.
 */
export function Roadmap(props: {
  workspaceId: WorkspaceId;
  /** The workspace's Paper file, when it has one: its boards open there. */
  paperFileId: string | undefined;
}) {
  const roadmap = useKept(KEPT_ROADMAP, {
    key: props.workspaceId,
    load: async () => {
      const loaded = await loadRoadmap(props.workspaceId);
      // Not on GitHub, or not signed in: there are no milestones to show. A read GitHub refused
      // comes as an answer, the last known with why (#519).
      return loaded.kind === "offline"
        ? undefined
        : loaded.kind === "loaded"
          ? loaded.data
          : { milestones: [] };
    },
  });
  const asOf = roadmap?.unread?.asOf;
  const aside = asOf === undefined || asOf === null ? undefined : `As of ${clockWords(asOf)}`;
  return (
    <div className="mt-4 flex flex-col md:min-h-0 md:flex-1">
      <Block
        label="Milestones, in build order"
        fillsSlot
        {...(aside === undefined ? {} : { aside })}
      >
        {roadmap?.unread !== undefined && <Unread unread={roadmap.unread} />}
        {roadmap === undefined ? (
          <PlaceholderRows count={4} size="row" />
        ) : roadmap.milestones.length === 0 ? (
          roadmap.unread === undefined && <BlockEmpty>No open milestones on GitHub</BlockEmpty>
        ) : (
          <Milestones milestones={roadmap.milestones} paperFileId={props.paperFileId} />
        )}
      </Block>
    </div>
  );
}

/** The milestones, the current one open. */
function Milestones(props: {
  milestones: readonly RoadmapMilestone[];
  paperFileId: string | undefined;
}) {
  const current = props.milestones.find((milestone) => progressOf(milestone).left > 0)?.title;
  /** The milestones the owner opened, or folded: the current one is open until folded. */
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(current === undefined ? [] : [current]),
  );
  const toggle = (title: string) =>
    setOpen((was) => {
      const now = new Set(was);
      if (!now.delete(title)) now.add(title);
      return now;
    });
  return (
    <BlockRows>
      <ul className="flex flex-col gap-1">
        {props.milestones.map((milestone) => (
          <Milestone
            key={milestone.title}
            milestone={milestone}
            current={milestone.title === current}
            open={open.has(milestone.title)}
            onToggle={() => toggle(milestone.title)}
            paperFileId={props.paperFileId}
          />
        ))}
      </ul>
    </BlockRows>
  );
}

/** One milestone's row, and its issues while it's open. */
function Milestone(props: {
  milestone: RoadmapMilestone;
  current: boolean;
  open: boolean;
  onToggle: () => void;
  paperFileId: string | undefined;
}) {
  const { milestone } = props;
  const progress = progressOf(milestone);
  const Chevron = props.open ? ChevronDown : ChevronRight;
  return (
    <li
      aria-label={milestone.title}
      className={classes("flex flex-col rounded-row", props.open && "bg-secondary/60 pb-1.5")}
    >
      <RowButton expanded={props.open} onClick={props.onToggle}>
        <span className="flex min-h-12 min-w-0 grow flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
          <Chevron aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 grow truncate text-interface font-bold md:grow-0 md:basis-auto">
            {milestone.title}
          </span>
          <span className="flex shrink-0 items-center gap-3 md:ml-auto">
            {props.current && (
              <CapsLabel tone="primary" inline>
                Now
              </CapsLabel>
            )}
            <span className="hidden md:block">
              <Progress done={progress.done} all={progress.all} />
            </span>
            <span className="w-14 text-right text-meta font-semibold text-foreground/85 tabular-nums">
              {progress.left} left
            </span>
          </span>
          {/* On a phone and the cover screen, the bar has a line of its own under the title. */}
          <span className="basis-full pl-6.5 md:hidden">
            <Progress done={progress.done} all={progress.all} wide />
          </span>
        </span>
      </RowButton>
      {props.open && <Issues issues={milestone.issues} paperFileId={props.paperFileId} />}
    </li>
  );
}

/** A milestone's progress, done of all, in moss on a quiet track. */
function Progress(props: { done: number; all: number; wide?: boolean }) {
  const share = props.all === 0 ? 0 : Math.round((props.done / props.all) * 100);
  return (
    <span
      role="img"
      aria-label={`${props.done} of ${props.all} done`}
      className={classes(
        "block h-1.5 overflow-hidden rounded-full bg-muted",
        props.wide ? "w-full" : "w-30",
      )}
    >
      <span className="block h-full rounded-full bg-success" style={{ width: `${share}%` }} />
    </span>
  );
}

/**
 * A milestone's issues: the first few open ones, then one row for the rest and the done ones,
 * which shows them all.
 */
function Issues(props: { issues: readonly RoadmapIssue[]; paperFileId: string | undefined }) {
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<number>();
  const open = props.issues.filter((issue) => issue.state.kind !== "done");
  const done = props.issues.length - open.length;
  const shown = all ? props.issues : open.slice(0, SHOWN_OPEN);
  const more = open.length - Math.min(open.length, SHOWN_OPEN);
  const folded = [
    ...(more > 0 ? [`${more} more open`] : []),
    ...(done > 0 ? [`${done} done`] : []),
  ].join(" · ");
  return (
    <ul className="flex flex-col pl-6 md:pl-7">
      {shown.map((issue) => (
        <Issue
          key={issue.number}
          issue={issue}
          open={opened === issue.number}
          onToggle={() => setOpened((was) => (was === issue.number ? undefined : issue.number))}
          paperFileId={props.paperFileId}
        />
      ))}
      {folded !== "" && (
        <li className="border-t border-border/60">
          <RowButton expanded={all} onClick={() => setAll((was) => !was)}>
            <span className="flex min-h-10 min-w-0 grow items-center gap-2.5">
              <Check aria-hidden className="size-3.5 shrink-0 text-success" />
              <span className="min-w-0 grow truncate text-meta font-semibold text-success">
                {all ? "All shown" : folded}
              </span>
              <span className="shrink-0 text-label font-semibold text-muted-foreground">
                {all ? "Fewer" : "Show ›"}
              </span>
            </span>
          </RowButton>
        </li>
      )}
    </ul>
  );
}

/** One issue: its number, title and state; tapped, its summary and boards. */
function Issue(props: {
  issue: RoadmapIssue;
  open: boolean;
  onToggle: () => void;
  paperFileId: string | undefined;
}) {
  const { issue } = props;
  const look = STATES[issue.state.kind];
  const words = wordsFor(issue.state);
  const waits = issue.state.kind === "blocked" || issue.state.kind === "done";
  return (
    <li
      aria-label={`#${issue.number} ${issue.title}, ${words}`}
      className="flex flex-col border-t border-border/60 first:border-t-0"
    >
      <RowButton expanded={props.open} onClick={props.onToggle}>
        <span className="flex min-h-11 min-w-0 grow flex-col justify-center gap-0.5 py-1.5 md:flex-row md:items-center md:gap-3">
          <span className="hidden w-11 shrink-0 text-meta font-semibold text-placeholder md:block">
            #{issue.number}
          </span>
          <span
            className={classes(
              "min-w-0 truncate text-meta font-semibold md:grow",
              waits ? "text-muted-foreground" : "text-foreground/90",
            )}
          >
            {issue.title}
          </span>
          <span
            className={classes(
              "flex min-w-0 items-center gap-1.5 text-label font-semibold md:w-32 md:shrink-0",
              look.text,
            )}
          >
            <span aria-hidden className={classes("size-2 shrink-0 rounded-full", look.dot)} />
            <span className="truncate">{words}</span>
            <span className="shrink-0 font-medium text-placeholder md:hidden">
              · #{issue.number}
            </span>
          </span>
        </span>
      </RowButton>
      {props.open && (
        <div className="flex flex-col gap-2 px-2.5 pt-1 pb-3 md:pl-16.5">
          <p className="text-meta text-foreground/85">
            {issue.summary === "" ? "It has no description." : issue.summary}
          </p>
          {issue.boards.map((board) => (
            <p key={board} className="text-meta text-muted-foreground">
              Board:{" "}
              {props.paperFileId === undefined ? (
                <span className="font-medium text-foreground/85">{board}</span>
              ) : (
                <WebLink
                  href={`https://app.paper.design/file/${encodeURIComponent(props.paperFileId)}`}
                >
                  {board}
                </WebLink>
              )}
            </p>
          ))}
          <p className="text-meta">
            <WebLink href={issue.url}>Open #{issue.number} on GitHub</WebLink>
          </p>
        </div>
      )}
    </li>
  );
}
