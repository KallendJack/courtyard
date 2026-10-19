import {
  buildable,
  type GitHubUnread,
  LEAD_WINDOW_BY_DEFAULT,
  type LeadStatus,
  type LeadWindow,
  type NextUp as NextUpAnswer,
  type NextUpIssue,
  type ProviderList,
  type WorkspaceId,
} from "@courtyard/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Clock, Flame, Play, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { Switch } from "@/components/forms/switch";
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

/** How many titles the Then line names. */
const THEN = 3;

/**
 * From a tablet up, a narrow column beside Needs you and Running, as tall as theirs, wide enough
 * that most titles fit on one line (#503).
 */
const COLUMN = "flex min-w-0 flex-col md:min-h-0 md:w-72.5 md:shrink-0 xl:w-80";

/**
 * Next up (#301, slimmed by #532; Paper, "Tablet · Code Home, slim Next up"): only what starts
 * the next thing, the milestone it's in beside the label. The first ready issue blocked by no open
 * one has Build (#298): one tap shows the issue and the model it'll be built with, a second starts
 * the session, which the worker claims the issue for. When an issue needs grilling first, Grill
 * takes the top in gold on the first in order (#363, #463), and the first ready issue sits under
 * it with a small Build. Under them, one faint Then line names the next few titles, and Whole
 * roadmap opens the Roadmap tab, saying how many more there are: the queue lives there. Under
 * Build, Run the build order starts the workspace's Lead, once the owner has seen what it does
 * (#347; Paper, "Code Home, Lead not started"); while it runs, the first issue says the Lead starts
 * it next, in Build's place ("Lead running"). With Grill on top, both sit under the small Build
 * (#550; Paper, "Code Home: Grill on top, Run the build order"). With none offered it says so.
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
export function Unread(props: { unread: GitHubUnread }) {
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
  const [next] = props.issues;
  /** The first issue to grill, in order across every milestone (#463): Grill takes the top. */
  const grill = props.issues.find((issue) => !issue.ready);
  /** The first ready issue blocked by no open one: Build's, under Grill when there is one. */
  const build = props.issues.find(buildable);
  const first = grill ?? build;
  const under = grill === undefined ? undefined : build;
  /** The other issues in order, those to grill and blocked ones in their place. */
  const rest = props.issues.filter((issue) => issue !== grill && issue !== build);
  /** What comes after the cards, by title: those blocked wait, so they aren't next. */
  const then = rest.filter((issue) => !issue.ready || issue.after === null).slice(0, THEN);
  /** How many more the Roadmap has on Next up's list. */
  const more = rest.length - then.length;
  const on = { workspaceId: props.workspaceId, providers: props.providers };
  return (
    <div className={COLUMN}>
      <Block label="Next up" aside={(first ?? next)?.milestone ?? undefined} fill>
        {props.unread !== undefined && <Unread unread={props.unread} />}
        {/* Grill, a Build under it and an open Start scroll together, as one (#408). */}
        <BlockRows>
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
          {/* With Grill on top, the Lead's controls go with the first ready issue under it (#550). */}
          {under !== undefined && (
            <StartOnIssue
              {...on}
              issue={under}
              does="build"
              small
              {...(props.lead === undefined
                ? {}
                : { lead: { status: props.lead, onLead: props.onLead } })}
            />
          )}
        </BlockRows>
        {(then.length > 0 || more > 0) && (
          <div className="flex shrink-0 flex-col gap-2.5 border-t border-border pt-2.5">
            {then.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <p className="text-label font-semibold text-placeholder">Then</p>
                <p className="line-clamp-3 text-meta text-foreground/70">
                  {then.map((issue) => issue.title).join(" · ")}
                </p>
              </div>
            )}
            <Link
              to="/workspaces/$workspaceId"
              params={{ workspaceId: props.workspaceId }}
              hash="roadmap"
              className="flex min-h-9 items-center justify-between gap-2 rounded-md bg-secondary px-3 text-meta font-semibold text-primary-text outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {more > 0 ? `Whole roadmap · ${more} more` : "Whole roadmap"}
              <ChevronRight aria-hidden className="size-4 shrink-0" />
            </Link>
          </div>
        )}
      </Block>
    </div>
  );
}

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
   * while it runs, that it starts this next in Build's place. On the small card under Grill, both
   * go under the card (#550).
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
  /** While the Lead runs, it starts this one: there's no Build to tap (Paper, "Lead running"). */
  const leadRuns = (
    <p className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-primary/35 bg-secondary text-meta font-bold text-primary-text">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
      Lead is running the order
    </p>
  );
  const runTheOrder = props.lead !== undefined && (
    <Button variant="outline" fullWidth onClick={() => setRunning(true)}>
      <Play aria-hidden />
      Run the build order
    </Button>
  );
  const card = (
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
            <p className={classes("text-meta font-medium", look.status)}>
              {leading ? status : "Ready"}
            </p>
          </div>
          {!confirming && !leading && (
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
      ) : (
        !props.small &&
        !grilling &&
        (leading ? (
          leadRuns
        ) : (
          <>
            <Button variant={look.variant} fullWidth onClick={() => setConfirming(true)}>
              <Icon aria-hidden />
              {look.label}
            </Button>
            {runTheOrder}
          </>
        ))
      )}
      {props.lead !== undefined && (
        // Run the build order, tapped: what starts, and Allow all for builders (#428; Paper, "Run
        // the build order: Allow all for builders"), off unless the owner turns it on.
        <DialogCard
          title="Run the build order"
          says={
            model === undefined
              ? "No model that codes is available right now."
              : `The Lead runs the build order with ${model.label}: it starts the next issues ${props.lead.status.builders} at a time, beginning with #${issue.number} ${issue.title}.${props.small ? " Issues that need grilling wait for you." : ""} Each is in a session of its own that claims its issue, and it tells you what's ready to merge. Merging stays yours.`
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
  if (!props.small || props.lead === undefined || confirming) return card;
  // Under Grill, the Lead's control sits under the small card, not in it (#550).
  return (
    <>
      {card}
      {leading ? leadRuns : runTheOrder}
    </>
  );
}
