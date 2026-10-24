import {
  type BuilderStatus,
  buildable,
  type CodeSessionList,
  LEAD_REVIEWS_AT_MOST,
  type LeadBuilderStatus,
  type LeadStatus,
  type NextUpIssue,
  type ProviderList,
  type SessionId,
  type WorkspaceId,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { PlaceholderRows } from "@courtyard/ui/layout/kept.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/buttons/button-link";
import { doingWords } from "@/components/chat/session-state";
import { AllowAllMark } from "@/components/code/allowing-all";
import { DialogCard } from "@/components/layout/dialog-card";
import { Block, BlockEmpty, BlockRows } from "@/components/layout/home-block";
import { describeProblem } from "../../components/layout/problems.tsx";
import { pauseLead, runLead } from "../code-home/api.ts";
import { useMergeInOrder } from "../code-home/merge-in-order.ts";
import { codingModelIn } from "../pull-requests/api.ts";
import { Allow, Retry } from "./builder-actions.tsx";
import {
  builderName,
  headerWords,
  lastedWords,
  nowWords,
  STATUS_NAMES,
  shownToday,
  wantsWords,
} from "./words.ts";

type Listed = CodeSessionList["sessions"][number];

/** Each status's look (AGENTS.md: violet live, gold needs the owner, moss passed, red failed). */
const LOOKS: Readonly<Record<BuilderStatus["kind"], { row: string; dot: string; words: string }>> =
  {
    building: {
      row: "border-transparent bg-secondary",
      dot: "bg-primary shadow-glow",
      words: "text-primary-text",
    },
    checking: {
      row: "border-transparent bg-secondary",
      dot: "border-2 border-primary",
      words: "text-primary-text",
    },
    "in-ci": {
      row: "border-transparent bg-secondary",
      dot: "border-2 border-primary",
      words: "text-primary-text",
    },
    "waiting-on-you": {
      row: "border-warning/25 bg-warning/8",
      dot: "bg-warning shadow-glow-needs",
      words: "text-warning",
    },
    "waiting-for-limit": {
      row: "border-transparent bg-secondary",
      dot: "bg-placeholder",
      words: "text-muted-foreground",
    },
    "ready-for-review": {
      row: "border-transparent bg-secondary",
      dot: "bg-success",
      words: "text-success",
    },
    merged: {
      row: "border-transparent bg-secondary",
      dot: "bg-success",
      words: "text-muted-foreground",
    },
    stuck: {
      row: "border-transparent bg-destructive-soft",
      dot: "bg-destructive",
      words: "text-destructive-text",
    },
  };

/** Whether a builder waits on the owner, gold or red on the board (#592): Waiting on you, Stuck. */
export const needsTheOwner = ({ status }: LeadBuilderStatus) =>
  status.kind === "waiting-on-you" || status.kind === "stuck";

/**
 * The Builders board (#592; Paper, "Tablet · Builders board, running", "… waits on you, Stuck,
 * limit", "Cover · Builders board, running"): at the top of a code workspace's Home, in Running's
 * and the Lead's row's place, everything the Lead and its builders are doing, in one set of words.
 * Its header says how many build and how many wait for review, and under it every reason it starts
 * no more, with Pause or Run, and Merge in order once more than one is ready. Then a row per
 * builder: its issue's name, its status and since when, what it's doing now, and one action when
 * there's one to take (Allow or Answer, Review, Retry); a row only working opens its session. A
 * merged one leaves at the end of the day. It keeps its size whatever it holds (#283). A builder's
 * notification opens it with that builder's row in view (#593).
 */
export function BuildersBoard(props: {
  workspaceId: WorkspaceId;
  /** The builder whose row is put in view as the board opens, as its notification asks (#593). */
  inView: SessionId | undefined;
  lead: LeadStatus | undefined;
  sessions: readonly Listed[];
  /** Next up's issues, once known, which name the issues it holds back. */
  issues: readonly NextUpIssue[] | undefined;
  providers: ProviderList["providers"] | undefined;
  /** The Lead was paused, woken or told to merge: the page shows it and asks again. */
  onLead: (lead: LeadStatus) => void;
  /** A builder was answered or retried: the page asks for its lists again. */
  onChanged: () => void;
}) {
  const { lead } = props;
  if (lead === undefined) {
    return (
      <Block label="Builders" tall>
        <PlaceholderRows count={3} />
      </Block>
    );
  }
  return <Board {...props} lead={lead} />;
}

/**
 * The board once its Lead is known (#592), with its controls: Pause while the Lead runs, Run
 * while it doesn't, and Merge in order (#423) once more than one of its builders' pull requests is
 * ready. With nothing running (never run, or paused with no builders) it's the same in every
 * workspace: Run and one quiet line (#648). Run the first time shows what the Lead does first.
 */
function Board(props: Parameters<typeof BuildersBoard>[0] & { lead: LeadStatus }) {
  const { lead } = props;
  const header = headerWords(lead, props.issues ?? [], LEAD_REVIEWS_AT_MOST);
  const rows = lead.statuses.filter(({ status }) => shownToday(status));
  const running = lead.state === "running";
  const neverRun = lead.state === "not-started";
  /** Run, tapped on a Lead that has never run: what it does shows first, in a dialog (#591). */
  const [explaining, setExplaining] = useState(false);
  const model = props.providers === undefined ? undefined : codingModelIn(props.providers);
  const act = useAction(async () => {
    const done = running
      ? await pauseLead(props.workspaceId)
      : model === undefined
        ? undefined
        : await runLead(props.workspaceId, { model: model.ref });
    if (done === undefined) return "No model that codes is available right now.";
    if (done.kind !== "loaded") return describeProblem(done).body;
    setExplaining(false);
    props.onLead(done.data);
    return undefined;
  });
  /** The first issue it builds, and whether any wait for grilling first, as Next up has them. */
  const first = props.issues?.find(buildable);
  const grilling = props.issues?.some((issue) => !issue.ready) === true;
  const merge = useMergeInOrder({
    workspaceId: props.workspaceId,
    pullRequests: lead.ready.map((ready) => ready.pullRequest),
    onMerging: props.onLead,
  });
  const inOrder = lead.ready.length > 1 && lead.merge?.kind !== "merging";
  return (
    <Block
      label="Builders"
      tall
      actions={
        <>
          {inOrder && (
            <Button
              variant="outline"
              size="xs"
              busy={merge.busy}
              busyLabel="Merging…"
              onClick={() => void merge.run()}
            >
              Merge in order
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            busy={act.busy}
            busyLabel={running ? "Pausing…" : neverRun ? "Starting…" : "Waking…"}
            onClick={() => (neverRun ? setExplaining(true) : void act.run())}
          >
            {running ? "Pause" : "Run"}
          </Button>
        </>
      }
    >
      <div className="flex shrink-0 flex-col gap-0.5 px-0.5 pb-1.5">
        {header.title !== undefined && <p className="text-interface/5 font-bold">{header.title}</p>}
        <p
          className={classes(
            "line-clamp-2 text-label font-medium",
            header.stopped ? "text-muted-foreground" : "text-primary-text",
          )}
        >
          {header.reasons}
        </p>
        <FormError message={explaining ? undefined : (act.error ?? merge.error)} />
      </div>
      <DialogCard
        title="Run"
        says={
          model === undefined
            ? "No model that codes is available right now."
            : `The Lead runs the build order with ${model.label}: it starts the next issues ${lead.builders} at a time${first === undefined ? "" : `, beginning with #${first.number} ${first.title}`}.${grilling ? " Issues that need grilling wait for you." : ""} Each is in a session of its own that claims its issue and allows all until its PR merges, still asking before anything outside its own branch. It keeps going through the night, and pauses itself while 4 PRs wait for your review. Merging stays yours.`
        }
        open={explaining}
        onClose={() => setExplaining(false)}
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              waiting={act.busy}
              onClick={() => setExplaining(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              grow
              disabled={model === undefined}
              busy={act.busy}
              busyLabel="Starting…"
              onClick={() => void act.run()}
            >
              Run
            </Button>
          </>
        }
      >
        <FormError message={act.error} />
      </DialogCard>
      {/* Nothing runs (never run, or paused with no builders): its one line says so (#646, #648).
          Too short for its empty line, the board scrolls it inside, as it would a row. */}
      {header.stopped ? null : rows.length === 0 ? (
        <BlockRows>
          <BlockEmpty>No builders right now</BlockEmpty>
        </BlockRows>
      ) : (
        <BlockRows>
          <ul className="flex flex-col gap-1.5">
            {rows.map((builder) => (
              <BuilderRow
                key={builder.session}
                workspaceId={props.workspaceId}
                inView={builder.session === props.inView}
                builder={builder}
                session={props.sessions.find((each) => each.id === builder.session)}
                onChanged={props.onChanged}
              />
            ))}
          </ul>
        </BlockRows>
      )}
    </Block>
  );
}

/**
 * One builder (#592): its dot, its issue's name, its status and since when ("Checking · 2 min"),
 * and what it's doing now; then its one action, or, only working, a quiet › with the whole row
 * opening its session. Opened from its notification, it's scrolled into view (#593).
 */
function BuilderRow(props: {
  workspaceId: WorkspaceId;
  inView: boolean;
  builder: LeadBuilderStatus;
  session: Listed | undefined;
  onChanged: () => void;
}) {
  const { builder, session } = props;
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.inView) row.current?.scrollIntoView({ block: "nearest" });
  }, [props.inView]);
  const { status } = builder;
  const look = LOOKS[status.kind];
  const name = builderName(builder.title);
  const doing = session?.now.kind === "working" ? doingWords(session.now.doing) : undefined;
  const action = actionOf({ ...props, name });
  const opens = (children: ReactNode) => (
    <Link
      to="/workspaces/$workspaceId/sessions/$sessionId"
      params={{ workspaceId: props.workspaceId, sessionId: builder.session }}
      className="flex min-w-0 grow items-center gap-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
  return (
    <li
      ref={row}
      aria-label={name}
      className={classes(
        "flex shrink-0 items-center gap-2.5 rounded-row border py-2 pr-2 pl-3",
        look.row,
      )}
    >
      {opens(
        <>
          <span aria-hidden className={classes("size-2 shrink-0 rounded-full", look.dot)} />
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="truncate text-sm/4.5 font-bold">{name}</span>
            <span className="flex min-w-0 flex-col">
              <span className={classes("text-label font-semibold", look.words)}>
                {STATUS_NAMES[status.kind]} · {lastedWords(status.since)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-label font-medium text-foreground/75">
                {/* It runs what Allow all covers without asking, until turned off (#730). */}
                {session?.allowingAll !== undefined && <AllowAllMark>allowing all</AllowAllMark>}
                <span className="truncate">{nowWords(status, session, doing)}</span>
              </span>
            </span>
          </span>
          {action === undefined && (
            <span className="flex h-7.5 w-19.5 shrink-0 items-center justify-end pr-2">
              <ChevronRight aria-hidden className="size-4 text-placeholder" />
            </span>
          )}
        </>,
      )}
      {action !== undefined && (
        <div className="flex min-w-19.5 shrink-0 flex-col items-end gap-1">{action}</div>
      )}
    </li>
  );
}

/** A row's one action, when it has one to take (#592): Allow or Answer, Review, Retry. */
const actionOf = (props: {
  workspaceId: WorkspaceId;
  builder: LeadBuilderStatus;
  session: Listed | undefined;
  name: string;
  onChanged: () => void;
}) => {
  const { builder, session, name } = props;
  const { status } = builder;
  switch (status.kind) {
    case "waiting-on-you":
      // Its approval, allowed here; its question, answered in its session.
      return session?.now.kind === "needs-you" ? (
        <Allow
          sessionId={builder.session}
          approval={session.now.approval}
          label={`${name} ${wantsWords(session.now.ask)}`}
          look="pill"
          onChanged={props.onChanged}
        />
      ) : (
        <ButtonLink
          to="/workspaces/$workspaceId/sessions/$sessionId"
          params={{ workspaceId: props.workspaceId, sessionId: builder.session }}
          variant="needs"
          size="row"
          aria-label={`Answer ${name}`}
        >
          Answer
        </ButtonLink>
      );
    case "ready-for-review":
      return (
        <ButtonLink
          to="/workspaces/$workspaceId"
          params={{ workspaceId: props.workspaceId }}
          hash={`pr-${status.pullRequest}`}
          variant="passed"
          size="row"
          aria-label={`Review ${name}`}
        >
          Review
        </ButtonLink>
      );
    case "stuck":
      return (
        <Retry sessionId={builder.session} name={name} look="pill" onChanged={props.onChanged} />
      );
    default:
      return undefined;
  }
};
