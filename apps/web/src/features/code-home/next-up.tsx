import {
  buildable,
  LEAD_WINDOW_BY_DEFAULT,
  type LeadStatus,
  type LeadWindow,
  type NextUp as NextUpAnswer,
  type NextUpIssue,
  type ProviderList,
  type WorkspaceId,
} from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { Clock, Flame, Play, Zap } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { Switch } from "@/components/forms/switch";
import { useBlocksFill } from "@/components/frame/handheld";
import { DialogCard } from "@/components/layout/dialog-card";
import { Block, BlockEmpty, BlockRows } from "@/components/layout/home-block";
import { PlaceholderRows } from "@/components/layout/kept";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { clockWords } from "@/lib/when";
import { describeProblem } from "../../components/layout/problems.tsx";
import { codingModelIn } from "../pull-requests/api.ts";
import { runLead, startOnIssue } from "./api.ts";

/** How long the Lead keeps going (#457), as the Run sheet offers it. */
const WINDOWS: readonly { value: LeadWindow; label: string }[] = [
  { value: "ready-now", label: "Just what's ready now" },
  { value: "4-hours", label: "4 hours" },
  { value: "tonight", label: "Until tonight" },
];

/** On a phone and the cover screen, how many issues show before More. */
const SHOWN = 3;

/**
 * From a tablet up, a narrow column beside Needs you and Running, as tall as theirs, wide enough
 * that most titles fit on one line (#503).
 */
const COLUMN = "flex min-w-0 flex-col md:min-h-0 md:w-72.5 md:shrink-0 xl:w-80";

/**
 * Next up (#301; Paper, "Code workspace Home"): the repository's ready issues nobody has claimed,
 * in milestone order, the milestone they're in beside its label: from a tablet up, as many as its
 * block has room for, then More for the rest (#418); on a phone, three, then More. The first has
 * Build (#298): one tap shows the issue and the model it'll be built with, a second starts the
 * session, which the worker claims the issue for. When an issue needs grilling first, Grill takes
 * the top in gold on the first in order (#363, #463; Paper, "Next up every issue"), and the first
 * ready issue sits under it with a small Build; on a phone the rest wait for More. The other
 * issues to grill keep their place among the rows, saying "Needs grilling first". A ready issue
 * blocked by an open one (#377; Paper, "Next up: blocked rows say After …") keeps its place, with
 * no Build, saying what it comes after; Build is on the first that isn't.
 * More opens the rest inside its card, which keeps its height, and becomes Fewer (#335). Under
 * Build, Run the build order starts the workspace's Lead, once the owner has seen what it does
 * (#347; Paper, "Code Home, Lead not started"); while it runs, the first issue says the Lead starts
 * it next, in Build's place ("Lead running"). With none offered it says so.
 */
export function NextUp(
  props: Offered & {
    /** `undefined` while nothing is known yet (a first visit): the block keeps its place. */
    issues: readonly NextUpIssue[] | undefined;
  },
) {
  if (props.issues === undefined) {
    return (
      <div className={COLUMN}>
        <Block label="Next up" fill>
          <PlaceholderRows count={1} size="tall" />
          <PlaceholderRows count={2} size="line" />
        </Block>
      </div>
    );
  }
  if (props.issues.length === 0) {
    return (
      <div className={COLUMN}>
        <Block label="Next up" fill aside={asOf(props.unread)}>
          {/* GitHub unread with nothing known: the line takes the empty line's place (#519). */}
          {props.unread === undefined ? (
            <BlockEmpty>Nothing ready to build</BlockEmpty>
          ) : (
            <Unread unread={props.unread} />
          )}
        </Block>
      </div>
    );
  }
  return <Offering {...props} issues={props.issues} />;
}

/** When the last list known was read, while GitHub can't be (#519): "As of 21:52". */
const asOf = (unread: NextUpAnswer["unread"]) =>
  unread === undefined || unread.asOf === null ? undefined : `As of ${clockWords(unread.asOf)}`;

/**
 * Why GitHub couldn't be read just now (#519; Paper, "Tablet · Code Home: Next up can't reach
 * GitHub"), in one quiet grey line under Next up's label, as the worker says it.
 */
function Unread(props: { unread: NonNullable<NextUpAnswer["unread"]> }) {
  const { unread } = props;
  return (
    <p
      role="status"
      className="flex shrink-0 items-center gap-2 rounded-md bg-secondary px-2.5 py-2 text-label font-medium text-foreground/75"
    >
      <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {unread.kind === "rate-limited"
        ? `GitHub's limit is used up · back at ${clockWords(unread.backAt)}`
        : "Can't reach GitHub"}
    </p>
  );
}

/** What Next up is given, besides its issues. */
type Offered = {
  /** Why GitHub couldn't be read just now, when it couldn't (#519): the issues are the last known. */
  unread?: NextUpAnswer["unread"];
  workspaceId: WorkspaceId;
  providers: ProviderList["providers"];
  /** The workspace's Lead (#347), once known: Run the build order sits under Build. */
  lead: LeadStatus | undefined;
  /** The Lead started or woke. */
  onLead: (lead: LeadStatus) => void;
};

/** Next up with at least one issue to offer. */
function Offering(props: Offered & { issues: readonly NextUpIssue[] }) {
  const [more, setMore] = useState(false);
  const [next] = props.issues;
  /** The first issue to grill, in order across every milestone (#463): Grill takes the top. */
  const grill = props.issues.find((issue) => !issue.ready);
  /** The first ready issue blocked by no open one: Build's, under Grill when there is one. */
  const build = props.issues.find(buildable);
  const first = grill ?? build;
  const under = grill === undefined ? undefined : build;
  /** The other issues in order, those to grill and blocked ones in their place. */
  const rest = props.issues.filter((issue) => issue !== grill && issue !== build);
  const room = useRoomFor(rest.length);
  const closed =
    room.fits !== undefined
      ? rest.slice(0, room.fits)
      : under === undefined
        ? rest.slice(0, SHOWN - 1)
        : [];
  const shown = more ? rest : closed;
  /** How many More opens. */
  const hidden = rest.length - closed.length;
  const on = { workspaceId: props.workspaceId, providers: props.providers };
  return (
    <div className={COLUMN}>
      <Block label="Next up" aside={asOf(props.unread) ?? next?.milestone ?? undefined} fill>
        {props.unread !== undefined && <Unread unread={props.unread} />}
        {/* The rows and More, in the room the layout gives them. */}
        <div ref={room.room} className="flex min-h-0 flex-1 flex-col gap-1.5">
          {/* Grill, a Build under it, an open Start and More's rows scroll together, as one (#408). */}
          <BlockRows>
            <div ref={room.head} className="flex flex-col gap-1.5">
              {first !== undefined && (
                <StartOnIssue
                  {...on}
                  issue={first}
                  does={first.ready ? "build" : "grill"}
                  {...(first.ready && props.lead !== undefined
                    ? { lead: { status: props.lead, onLead: props.onLead } }
                    : {})}
                />
              )}
              {under !== undefined && <StartOnIssue {...on} issue={under} does="build" small />}
            </div>
            {shown.length > 0 && (
              <ul ref={room.list} className="flex flex-col gap-0.5 pt-1">
                {shown.map((issue) => {
                  /** What it waits on, under its title: a grill (#463), else an open issue (#377). */
                  const waits = !issue.ready
                    ? { says: "Needs grilling first", named: "needs grilling first" }
                    : issue.after === null
                      ? undefined
                      : { says: `After ${issue.after}`, named: `after ${issue.after}` };
                  return (
                    <li
                      key={issue.number}
                      aria-label={`#${issue.number} ${issue.title}${waits === undefined ? "" : `, ${waits.named}`}`}
                    >
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-8.5 items-center gap-2.5 rounded-md px-2.5 hover:bg-secondary"
                      >
                        <span className="w-8.5 shrink-0 text-meta font-bold text-placeholder">
                          #{issue.number}
                        </span>
                        <span className="flex min-w-0 grow flex-col">
                          <span className="truncate text-meta font-semibold text-foreground/90">
                            {issue.title}
                          </span>
                          {/* What it waits on, in a row as tall as one in one line. */}
                          {waits !== undefined && (
                            <span className="truncate text-label font-medium text-muted-foreground">
                              {waits.says}
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </BlockRows>
          {hidden > 0 && (
            <div ref={room.more} className="shrink-0">
              <Button variant="quietPrimary" size="xs" onClick={() => setMore((was) => !was)}>
                {more ? "Fewer" : `More · ${hidden}`}
              </Button>
            </div>
          )}
        </div>
      </Block>
    </div>
  );
}

/**
 * From a tablet up, how many of Next up's rows its block has room for (#418), now the block's size
 * is the layout's (#398): the room for its rows and More, less the cards above the rows, in rows
 * as tall as they're drawn, leaving More's place when they don't all fit. Measured before the block
 * is painted and again whenever the room or the cards change size (Build tapped, the window
 * resized). `fits` is `undefined` below a tablet, where Next up shows three.
 */
function useRoomFor(count: number) {
  const fills = useBlocksFill();
  const room = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const more = useRef<HTMLDivElement>(null);
  /** The sizes last drawn, kept for when there's no row or More to measure. */
  const drawn = useRef<{ row?: number; gap?: number; above?: number; more?: number }>({});
  const [measured, setMeasured] = useState<number>();
  const measure = useRef(() => {});
  measure.current = () => {
    const [box, cards] = [room.current, head.current];
    if (!fills || box === null || cards === null) return;
    const sizes = drawn.current;
    const row = list.current?.firstElementChild;
    if (list.current && row) {
      const bounds = row.getBoundingClientRect();
      sizes.row = bounds.height;
      sizes.gap = gapOf(list.current);
      sizes.above = bounds.top - cards.getBoundingClientRect().bottom;
    }
    if (more.current !== null)
      sizes.more = more.current.getBoundingClientRect().height + gapOf(box);
    const { row: tall, gap = 0, above = 0 } = sizes;
    // No row drawn yet: all of them are, next, so one can be measured.
    if (tall === undefined) {
      setMeasured(count);
      return;
    }
    const space = box.getBoundingClientRect().height - cards.getBoundingClientRect().height - above;
    // Half a pixel's grace for rounding: a row past it would make the rows scroll.
    const rowsIn = (height: number) => Math.max(0, Math.floor((height + gap + 0.5) / (tall + gap)));
    const all = rowsIn(space);
    // Not all of them fit: More takes its place under them, measured once it's drawn.
    setMeasured(all >= count ? count : sizes.more === undefined ? all : rowsIn(space - sizes.more));
  };
  // After every render, before it's painted: a first draw never shows rows that don't fit.
  useLayoutEffect(() => measure.current());
  useEffect(() => {
    const observer = new ResizeObserver(() => measure.current());
    for (const each of [room.current, head.current]) if (each !== null) observer.observe(each);
    return () => observer.disconnect();
  }, []);
  // Until it's measured, every row is drawn so one can be.
  return { room, head, list, more, fits: fills ? (measured ?? count) : undefined };
}

/** The gap between an element's rows, in pixels. */
const gapOf = (element: Element) => Number.parseFloat(getComputedStyle(element).rowGap) || 0;

/** What Build and Grill say and look like. */
const STARTS = {
  build: {
    label: "Build",
    start: "Start building",
    icon: Zap,
    variant: "primary",
    card: "border-primary/35 bg-primary/12",
    status: "text-primary-text",
    says: (model: string) =>
      `A new session builds it with ${model}, on a branch of its own, and claims it on GitHub.`,
  },
  grill: {
    label: "Grill",
    start: "Start grilling",
    icon: Flame,
    variant: "needs",
    card: "border-warning/25 bg-warning/8",
    status: "text-warning",
    says: (model: string) =>
      `A new session grills it with ${model}, one question at a time, and marks it ready to build once you agree.`,
  },
} as const;

/**
 * An issue with Build (#298) or Grill (#363). Tapped, it shows what starts (the issue, the model,
 * and for Build its own branch and the claim on GitHub) with Start building or Start grilling, so
 * one more tap does exactly that (AGENTS.md, Tap or talk). `small` is the ready issue under Grill:
 * one line, with a small Build beside it.
 */
function StartOnIssue(props: {
  workspaceId: WorkspaceId;
  issue: NextUpIssue;
  providers: ProviderList["providers"];
  does: keyof typeof STARTS;
  small?: boolean;
  /**
   * On the first ready issue, the workspace's Lead (#347): Run the build order under Build, or,
   * while it runs, that it starts this next in Build's place.
   */
  lead?: { status: LeadStatus; onLead: (lead: LeadStatus) => void };
}) {
  const { issue } = props;
  const look = STARTS[props.does];
  const Icon = look.icon;
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  /** Run the build order, tapped: what starts shows first, in a dialog, with Run the build order. */
  const [running, setRunning] = useState(false);
  /** Allow all for builders (#428), off unless the owner turns it on. */
  const [allowAll, setAllowAll] = useState(false);
  const allowAllName = useId();
  /** How long it keeps going (#457), 4 hours unless the owner says. */
  const [keepGoing, setKeepGoing] = useState<LeadWindow>(LEAD_WINDOW_BY_DEFAULT);
  const leading = props.lead?.status.state === "running";
  /** Start and Cancel, brought into view when they open in a column too short for them (#335). */
  const choices = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) choices.current?.scrollIntoView({ block: "nearest" });
  }, [confirming]);
  const model = codingModelIn(props.providers);
  const start = useAction(async () => {
    if (model === undefined) return "No model that codes is available right now.";
    const started = await startOnIssue({
      workspaceId: props.workspaceId,
      number: issue.number,
      does: props.does,
      model: { model: model.ref },
    });
    if (started.kind !== "loaded") return describeProblem(started).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: props.workspaceId, sessionId: started.data.id },
    });
    return undefined;
  });
  const runOrder = useAction(async () => {
    if (model === undefined) return "No model that codes is available right now.";
    const started = await runLead(props.workspaceId, {
      model: model.ref,
      allowAll,
      window: keepGoing,
    });
    if (started.kind !== "loaded") return describeProblem(started).body;
    setRunning(false);
    props.lead?.onLead(started.data);
    return undefined;
  });
  /** Grill's card (#503; Paper, "Code Home, roomier on the Fold"): its title in two lines at most. */
  const grilling = props.does === "grill";
  const title = (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      className={classes(
        "hover:underline",
        props.small
          ? "truncate text-meta font-semibold text-foreground/90"
          : "text-sm/4.5 font-bold",
        grilling && "line-clamp-2",
      )}
    >
      {/* Under Grill, and on Grill itself as on its board, the title is enough. */}
      {props.small || props.does === "grill" ? issue.title : `#${issue.number} ${issue.title}`}
    </a>
  );
  /** The builder's issue the Lead holds this one back behind (#423), changing the same files. */
  const behind = leading
    ? props.lead?.status.heldBack?.find((held) => held.issue === issue.number)?.behind
    : undefined;
  const status = grilling
    ? "Needs grilling first"
    : behind !== undefined
      ? `Held back · same files as #${behind}, starts once it merges`
      : leading
        ? "The Lead starts this next"
        : "Ready to build";
  return (
    <section
      aria-label={`${look.label} #${issue.number}`}
      className={classes(
        "flex flex-col rounded-row border",
        look.card,
        props.small ? "gap-2 py-2 pr-1.5 pl-2.5" : "gap-2.5 p-3",
      )}
    >
      {props.small ? (
        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 grow flex-col">
            {title}
            <p className={classes("text-meta font-medium", look.status)}>Ready</p>
          </div>
          {!confirming && (
            <Button variant={look.variant} size="xs" onClick={() => setConfirming(true)}>
              <Icon aria-hidden />
              {look.label}
            </Button>
          )}
        </div>
      ) : grilling ? (
        // Its status with a small Grill beside it, not a full-width button under it (#503).
        <div className="flex flex-col gap-2">
          {title}
          <div className="flex items-center justify-between gap-2">
            <p className={classes("text-meta font-medium", look.status)}>{status}</p>
            {!confirming && (
              <Button variant={look.variant} size="xs" onClick={() => setConfirming(true)}>
                <Icon aria-hidden />
                {look.label}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          {title}
          <p className={classes("text-meta font-medium", look.status)}>{status}</p>
        </div>
      )}
      {confirming ? (
        <>
          <p className="text-meta text-foreground/90">
            {model === undefined
              ? "No model that codes is available right now."
              : look.says(model.label)}
          </p>
          {/* In the narrow column the two don't fit side by side, so Cancel wraps under (#346). */}
          <div ref={choices} className="flex flex-wrap justify-end gap-2">
            <Button
              variant={look.variant}
              grow
              disabled={model === undefined}
              busy={start.busy}
              busyLabel="Starting…"
              onClick={() => void start.run()}
            >
              <Icon aria-hidden />
              {look.start}
            </Button>
            <Button variant="outline" waiting={start.busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
          <FormError message={start.error} />
        </>
      ) : leading ? (
        // While the Lead runs, it starts this one: there's no Build to tap (Paper, "Lead running").
        <p className="flex h-9 items-center justify-center gap-2 rounded-full border border-primary/35 bg-secondary text-meta font-bold text-primary-text">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
          Lead is running the order
        </p>
      ) : (
        !props.small &&
        !grilling && (
          <>
            <Button variant={look.variant} fullWidth onClick={() => setConfirming(true)}>
              <Icon aria-hidden />
              {look.label}
            </Button>
            {props.lead !== undefined && (
              <Button variant="outline" fullWidth onClick={() => setRunning(true)}>
                <Play aria-hidden />
                Run the build order
              </Button>
            )}
          </>
        )
      )}
      {props.lead !== undefined && (
        // Run the build order, tapped: what starts, and Allow all for builders (#428; Paper, "Run
        // the build order: Allow all for builders"), off unless the owner turns it on.
        <DialogCard
          title="Run the build order"
          says={
            model === undefined
              ? "No model that codes is available right now."
              : `The Lead runs the build order with ${model.label}: it starts the next issues ${props.lead.status.builders} at a time, beginning with #${issue.number} ${issue.title}, each in a session of its own that claims its issue, and tells you what's ready to merge. Merging stays yours.`
          }
          open={running}
          onClose={() => setRunning(false)}
          actions={
            <>
              <Button
                variant="outline"
                size="lg"
                waiting={runOrder.busy}
                onClick={() => setRunning(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                grow
                disabled={model === undefined}
                busy={runOrder.busy}
                busyLabel="Starting…"
                onClick={() => void runOrder.run()}
              >
                Run the build order
              </Button>
            </>
          }
        >
          {/* How long it keeps going (#457), in the same row style as Allow all for builders. */}
          <div className="flex flex-col gap-2.5 rounded-row bg-secondary px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-interface font-bold text-foreground">Keep going</p>
              <p className="text-meta text-muted-foreground">
                Within it, a resting Lead wakes for new work. It builds 4 at most each run, and none
                while 2 PRs wait on your review.
              </p>
            </div>
            <SegmentedChoice
              label="Keep going"
              look="apart"
              options={WINDOWS}
              value={keepGoing}
              onChange={setKeepGoing}
            />
          </div>
          <div className="flex items-center gap-3 rounded-row bg-secondary px-4 py-3">
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <p id={`${allowAllName}-name`} className="text-interface font-bold text-foreground">
                Allow all for builders
              </p>
              <p id={`${allowAllName}-more`} className="text-meta text-muted-foreground">
                For 12 hours, or until each builder's PR opens. Each one still asks before anything
                outside its own branch.
              </p>
            </div>
            <Switch
              on={allowAll}
              onChange={setAllowAll}
              labelledBy={`${allowAllName}-name`}
              describedBy={`${allowAllName}-more`}
            />
          </div>
          <FormError message={runOrder.error} />
        </DialogCard>
      )}
    </section>
  );
}
