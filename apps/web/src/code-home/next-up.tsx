import type { LeadStatus, NextUpIssue, ProviderList, WorkspaceId } from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { Flame, Play, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { useBlocksFill } from "@/components/handheld";
import { Block, BlockEmpty, BlockRows } from "@/components/home-block";
import { PlaceholderRows } from "@/components/kept";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { codingModelIn } from "../review/api.ts";
import { runLead, startOnIssue } from "./api.ts";

/** On a phone and the cover screen, how many issues show before More. */
const SHOWN = 3;

/** From a tablet up, a narrow column beside Needs you and Running, as tall as theirs. */
const COLUMN = "flex min-w-0 flex-col md:min-h-0 md:w-62.5 md:shrink-0 xl:w-80";

/**
 * Next up (#301; Paper, "Code workspace Home"): the repository's ready issues nobody has claimed,
 * in milestone order, the milestone they're in beside its label: from a tablet up, as many as its
 * block has room for, then More for the rest (#418); on a phone, three, then More. The first has
 * Build (#298): one tap shows the issue and the model it'll be built with, a second starts the
 * session, which the worker claims the issue for. When the next in order on its Build order line
 * needs grilling first, Grill takes the top in gold (#363; Paper, "Next up offers Grill"), and the
 * first ready issue sits under it with a small Build; on a phone the rest wait for More.
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
  const [first] = props.issues;
  if (first === undefined) {
    return (
      <div className={COLUMN}>
        <Block label="Next up" fill>
          <BlockEmpty>Nothing ready to build</BlockEmpty>
        </Block>
      </div>
    );
  }
  return <Offering {...props} issues={props.issues} first={first} />;
}

/** What Next up is given, besides its issues. */
type Offered = {
  workspaceId: WorkspaceId;
  providers: ProviderList["providers"];
  /** The workspace's Lead (#347), once known: Run the build order sits under Build. */
  lead: LeadStatus | undefined;
  /** The Lead started or woke. */
  onLead: (lead: LeadStatus) => void;
};

/** Next up with at least one issue to offer. */
function Offering(props: Offered & { issues: readonly NextUpIssue[]; first: NextUpIssue }) {
  const { first } = props;
  const [more, setMore] = useState(false);
  const ready = props.issues.filter((issue) => issue.ready);
  /** The first ready issue, under Grill when the next in order needs grilling. */
  const under = first.ready ? undefined : ready[0];
  const rest = ready.filter((issue) => issue !== first && issue !== under);
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
      <Block label="Next up" aside={first.milestone ?? undefined} fill>
        {/* The rows and More, in the room the layout gives them. */}
        <div ref={room.room} className="flex min-h-0 flex-1 flex-col gap-1.5">
          {/* Grill, a Build under it, an open Start and More's rows scroll together, as one (#408). */}
          <BlockRows>
            <div ref={room.head} className="flex flex-col gap-1.5">
              <StartOnIssue
                {...on}
                issue={first}
                does={first.ready ? "build" : "grill"}
                {...(first.ready && props.lead !== undefined
                  ? { lead: { status: props.lead, onLead: props.onLead } }
                  : {})}
              />
              {under !== undefined && <StartOnIssue {...on} issue={under} does="build" small />}
            </div>
            {shown.length > 0 && (
              <ul ref={room.list} className="flex flex-col gap-0.5 pt-1">
                {shown.map((issue) => (
                  <li key={issue.number} aria-label={`#${issue.number} ${issue.title}`}>
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-8.5 items-center gap-2.5 rounded-md px-2.5 hover:bg-secondary"
                    >
                      <span className="w-8.5 shrink-0 text-meta font-bold text-placeholder">
                        #{issue.number}
                      </span>
                      <span className="min-w-0 grow truncate text-meta font-semibold text-foreground/90">
                        {issue.title}
                      </span>
                    </a>
                  </li>
                ))}
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
  /** Run the build order, tapped: what starts shows first, with Start the order. */
  const [running, setRunning] = useState(false);
  const leading = props.lead?.status.state === "running";
  /** Start and Cancel, brought into view when they open in a column too short for them (#335). */
  const choices = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming || running) choices.current?.scrollIntoView({ block: "nearest" });
  }, [confirming, running]);
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
    const started = await runLead(props.workspaceId, { model: model.ref });
    if (started.kind !== "loaded") return describeProblem(started).body;
    setRunning(false);
    props.lead?.onLead(started.data);
    return undefined;
  });
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
      )}
    >
      {/* Under Grill, and on Grill itself as on its board, the title is enough. */}
      {props.small || props.does === "grill" ? issue.title : `#${issue.number} ${issue.title}`}
    </a>
  );
  const status =
    props.does === "grill"
      ? "Next in order · needs grilling first"
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
      ) : running ? (
        <>
          <p className="text-meta text-foreground/90">
            {model === undefined
              ? "No model that codes is available right now."
              : `The Lead runs the build order with ${model.label}: it starts the next issues ${props.lead?.status.builders ?? 2} at a time, each in a session of its own that claims its issue, and tells you what's ready to merge. Merging stays yours.`}
          </p>
          <div ref={choices} className="flex flex-wrap justify-end gap-2">
            <Button
              variant="primary"
              grow
              disabled={model === undefined}
              busy={runOrder.busy}
              busyLabel="Starting…"
              onClick={() => void runOrder.run()}
            >
              <Play aria-hidden />
              Start the order
            </Button>
            <Button variant="outline" waiting={runOrder.busy} onClick={() => setRunning(false)}>
              Cancel
            </Button>
          </div>
          <FormError message={runOrder.error} />
        </>
      ) : leading ? (
        // While the Lead runs, it starts this one: there's no Build to tap (Paper, "Lead running").
        <p className="flex h-9 items-center justify-center gap-2 rounded-full border border-primary/35 bg-secondary text-meta font-bold text-primary-text">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
          Lead is running the order
        </p>
      ) : (
        !props.small && (
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
    </section>
  );
}
