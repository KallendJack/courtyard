import {
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  type LeadStatus,
  type ProviderList,
  type WorkspaceId,
} from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/buttons/button";
import { doingWords } from "@/components/chat/session-state";
import { AllowAllMark, timeLeft } from "@/components/code/allowing-all";
import { ByLead, LeadMark } from "@/components/code/lead-mark";
import { FormError } from "@/components/forms/form-error";
import { Block, BlockEmpty, BlockRows } from "@/components/layout/home-block";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { codingModelIn } from "../pull-requests/api.ts";
import { pauseLead, runLead } from "./api.ts";

type Listed = CodeSessionList["sessions"][number];

/** How long a turn has run, in minutes: "3 min", or "just started". */
const forWords = (since: string, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  return minutes < 1 ? "just started" : `${minutes} min`;
};

/** Words as a sentence starts them. */
const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * How many turns wait ahead of a session's for a place among the code sessions running (#362);
 * `undefined` when it isn't waiting for one (none when the worker didn't say, before #362).
 */
const placesAhead = (session: Listed) => {
  if (session.now.kind !== "working" || session.now.doing.kind !== "waiting-for-place") {
    return undefined;
  }
  return session.now.doing.ahead ?? 0;
};

/**
 * Running (#301; Paper, "Code workspace Home"): the workspace's sessions working now, every one,
 * each with what it's doing and for how long, and how many of the worker's slots are taken. Those
 * running come first, then those waiting for a place, the next to start first (#362). Once the
 * owner has run the build order, its Lead's row comes first (#347; Paper, "Code Home, Lead
 * running" and "Lead resting"), uncounted, and its builders are marked "by Lead". It keeps its
 * size beside Needs you, a few rows at most then scrolling inside (#335); with none working it
 * says so.
 */
export function Running(props: {
  workspaceId: WorkspaceId;
  sessions: readonly Listed[];
  /** How many code sessions are running across the worker. */
  running: number;
  /** The workspace's Lead, once known. */
  lead: LeadStatus | undefined;
  providers: ProviderList["providers"] | undefined;
  /** The Lead was paused or woken: the page asks for it again. */
  onLead: (lead: LeadStatus) => void;
}) {
  const busy = props.sessions.filter(
    (session) => session.now.kind === "working" && session.lead !== true,
  );
  const waiting = busy
    .flatMap((session) => {
      const ahead = placesAhead(session);
      return ahead === undefined ? [] : [{ session, ahead }];
    })
    .sort((a, b) => a.ahead - b.ahead)
    .map(({ session }) => session);
  const working = [...busy.filter((session) => !waiting.includes(session)), ...waiting];
  const aside = `${props.running} of ${CODE_SESSIONS_AT_ONCE}`;
  const { lead } = props;
  const leadRow =
    lead !== undefined && lead.session !== undefined && lead.state !== "not-started" ? (
      <LeadRow
        workspaceId={props.workspaceId}
        lead={lead}
        session={lead.session}
        providers={props.providers}
        onLead={props.onLead}
      />
    ) : undefined;
  if (working.length === 0 && leadRow === undefined) {
    return (
      <Block label="Running" aside={aside} fill>
        <BlockEmpty>Nothing running</BlockEmpty>
      </Block>
    );
  }
  return (
    <Block label="Running" aside={aside} fill>
      <BlockRows>
        <ul className="flex flex-col gap-1.5">
          {leadRow}
          {working.map((session) => (
            <li key={session.id} aria-label={session.title}>
              <Link
                to="/workspaces/$workspaceId/sessions/$sessionId"
                params={{ workspaceId: props.workspaceId, sessionId: session.id }}
                className="flex items-center gap-2.5 rounded-row bg-secondary px-3 py-2.5 hover:bg-muted"
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary shadow-glow" />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate text-sm/4.5 font-bold">{session.title}</span>
                  <span className="truncate text-meta font-medium text-primary-text">
                    {session.now.kind === "working" &&
                      `${capitalised(doingWords(session.now.doing))} · ${forWords(session.now.since)}`}
                  </span>
                </span>
                {session.allowingAll !== undefined && <AllowAllMark>Allowing all</AllowAllMark>}
                {session.byLead === true ? (
                  <ByLead />
                ) : (
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-placeholder" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </BlockRows>
    </Block>
  );
}

/** "2 building · 1 PR ready", or where the Lead stands when it isn't running. */
const leadTitle = (lead: LeadStatus) => {
  if (lead.state === "paused") return "Paused";
  if (lead.state === "resting") return "Resting";
  const ready = lead.ready.length;
  return `${lead.building.length} building · ${ready} ${ready === 1 ? "PR" : "PRs"} ready`;
};

/**
 * The line under it: what it's doing, or why it holds back, rests or is paused. While it runs with
 * Allow all for builders (#428), how long that has left.
 */
const leadLine = (lead: LeadStatus) => {
  switch (lead.state) {
    case "running":
      if (lead.why !== undefined) return `Holding back: ${lead.why}`;
      return lead.buildersAllowedAll === undefined
        ? "Running the build order"
        : `Builders allowed all · ${timeLeft({ until: lead.buildersAllowedAll, now: Date.now(), roughly: true })} left`;
    case "paused":
      return "Builders carry on · nothing new starts";
    default:
      return lead.why ?? "Nothing ready to build";
  }
};

/**
 * The Lead's row (#347): its mark, how many build and how many pull requests are ready, a tap to
 * its chat, and a quiet Pause while it runs, or Run, which wakes it, while it rests or is paused.
 */
function LeadRow(props: {
  workspaceId: WorkspaceId;
  lead: LeadStatus;
  session: NonNullable<LeadStatus["session"]>;
  providers: ProviderList["providers"] | undefined;
  onLead: (lead: LeadStatus) => void;
}) {
  const { lead } = props;
  const running = lead.state === "running";
  const act = useAction(async () => {
    const model = props.providers === undefined ? undefined : codingModelIn(props.providers);
    const done = running
      ? await pauseLead(props.workspaceId)
      : model === undefined
        ? undefined
        : await runLead(props.workspaceId, { model: model.ref });
    if (done === undefined) return "No model that codes is available right now.";
    if (done.kind !== "loaded") return describeProblem(done).body;
    props.onLead(done.data);
    return undefined;
  });
  return (
    <li
      aria-label="Lead"
      className="flex items-center gap-2.5 rounded-row border border-primary/35 bg-primary/12 py-2 pr-2 pl-2.5"
    >
      <Link
        to="/workspaces/$workspaceId/sessions/$sessionId"
        params={{ workspaceId: props.workspaceId, sessionId: props.session }}
        className="flex min-w-0 grow items-center gap-2.5"
      >
        <LeadMark />
        <span className="flex min-w-0 grow flex-col gap-px">
          <span className="truncate text-sm/4.5 font-bold">{leadTitle(lead)}</span>
          <span className="truncate text-meta font-medium text-primary-text">{leadLine(lead)}</span>
        </span>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          variant="outline"
          size="xs"
          busy={act.busy}
          busyLabel={running ? "Pausing…" : "Waking…"}
          onClick={() => void act.run()}
        >
          {running ? "Pause" : "Run"}
        </Button>
        <FormError message={act.error} />
      </div>
    </li>
  );
}
