import {
  CODE_SESSIONS_AT_ONCE,
  type CodeSessionList,
  type LeadStatus,
  type ProviderList,
  type WorkspaceId,
} from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/buttons/button";
import { doingWords } from "@/components/chat/session-state";
import { AllowAllMark, timeLeft } from "@/components/code/allowing-all";
import { ByLead, LeadMark } from "@/components/code/lead-mark";
import { FormError } from "@/components/forms/form-error";
import { Block, BlockEmpty, BlockRows } from "@/components/layout/home-block";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { clockWords } from "@/lib/when";
import { describeProblem } from "../../components/layout/problems.tsx";
import { codingModelIn } from "../pull-requests/api.ts";
import { AllowAllBuilders } from "./allow-all-builders.tsx";
import { allowAllForBuilders, pauseLead, runLead } from "./api.ts";
import { waitsUntilAnswered } from "./needs.ts";

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
 * Running (#301; Paper, "Code workspace Home"): the workspace's sessions working now, every one
 * (never one waiting on the owner, which Needs you shows, #541),
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
        waitOnYou={
          props.sessions.filter((session) => session.byLead === true && waitsUntilAnswered(session))
            .length
        }
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

/**
 * "2 building · 1 PR ready", with "· 2 wait on you" while builders wait until the owner answers
 * (#541), or where the Lead stands when it isn't running.
 */
const leadTitle = (lead: LeadStatus, waitOnYou: number) => {
  if (lead.state === "paused") return "Paused";
  if (lead.state === "resting") return "Resting";
  const ready = lead.ready.length;
  const waits = waitOnYou === 0 ? "" : ` · ${waitOnYou} ${waitOnYou === 1 ? "waits" : "wait"} on you`;
  return `${lead.building.length} building · ${ready} ${ready === 1 ? "PR" : "PRs"} ready${waits}`;
};

/**
 * The line under it: what it's doing, or why it holds back, rests or is paused; resting within its
 * window (#457), until when it wakes for new work (its chat says why it rests).
 */
const leadLine = (lead: LeadStatus) => {
  if (lead.state === "resting" && lead.wakesUntil !== undefined) {
    return `Wakes for new work until ${clockWords(lead.wakesUntil)}`;
  }
  switch (lead.state) {
    case "running":
      return lead.why === undefined ? "Running the build order" : `Holding back: ${lead.why}`;
    case "paused":
      return "Builders carry on · nothing new starts";
    default:
      return lead.why ?? "Nothing ready to build";
  }
};

/**
 * Its two lines (#551; Paper, "Lead row: Allow all for builders, on"): while Allow all for
 * builders is on, how long it has left takes the second, in gold, and a reason it holds back, if
 * it does, the first.
 */
const leadLines = (lead: LeadStatus, waitOnYou: number) => {
  if (lead.buildersAllowedAll === undefined) {
    return { first: leadTitle(lead, waitOnYou), second: leadLine(lead), allowing: false };
  }
  const left = timeLeft({ until: lead.buildersAllowedAll, now: Date.now(), roughly: true });
  return {
    first:
      lead.state === "running" && lead.why !== undefined
        ? leadLine(lead)
        : leadTitle(lead, waitOnYou),
    second: `Builders allowed all · ${left} left`,
    allowing: true,
  };
};

/**
 * The Lead's row (#347): its mark, how many build and how many pull requests are ready, a tap to
 * its chat, and, on a line of their own under it (#551), Allow all for builders… (Turn off while
 * it's on) and a quiet Pause while it runs, or Run, which wakes it, while it rests or is paused.
 */
function LeadRow(props: {
  workspaceId: WorkspaceId;
  lead: LeadStatus;
  session: NonNullable<LeadStatus["session"]>;
  providers: ProviderList["providers"] | undefined;
  /** How many of its builders wait until the owner answers (#541). */
  waitOnYou: number;
  onLead: (lead: LeadStatus) => void;
}) {
  const { lead } = props;
  const running = lead.state === "running";
  const [asking, setAsking] = useState(false);
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
  /** Allow all for builders switched on (from its sheet) or off. */
  const allowAll = async (on: boolean) => {
    const done = await allowAllForBuilders(props.workspaceId, on);
    if (done.kind !== "loaded") return describeProblem(done).body;
    props.onLead(done.data);
    return undefined;
  };
  const turnOff = useAction(() => allowAll(false));
  const lines = leadLines(lead, props.waitOnYou);
  return (
    <li
      aria-label="Lead"
      className="flex flex-col gap-2 rounded-row border border-primary/35 bg-primary/12 p-2.5"
    >
      <Link
        to="/workspaces/$workspaceId/sessions/$sessionId"
        params={{ workspaceId: props.workspaceId, sessionId: props.session }}
        className="flex min-w-0 items-center gap-2.5"
      >
        <LeadMark />
        <span className="flex min-w-0 grow flex-col gap-px">
          <span className="truncate text-sm/4.5 font-bold">{lines.first}</span>
          <span
            className={classes(
              "truncate text-meta",
              lines.allowing ? "font-semibold text-warning" : "font-medium text-primary-text",
            )}
          >
            {lines.second}
          </span>
        </span>
      </Link>
      <div className="flex flex-wrap justify-end gap-2">
        {lines.allowing ? (
          <Button
            variant="needsOutline"
            size="xs"
            busy={turnOff.busy}
            busyLabel="Turning off…"
            waiting={act.busy}
            onClick={() => void turnOff.run()}
          >
            Turn off
          </Button>
        ) : (
          <Button variant="outline" size="xs" waiting={act.busy} onClick={() => setAsking(true)}>
            Allow all for builders…
          </Button>
        )}
        <Button
          variant="outline"
          size="xs"
          busy={act.busy}
          busyLabel={running ? "Pausing…" : "Waking…"}
          waiting={turnOff.busy}
          onClick={() => void act.run()}
        >
          {running ? "Pause" : "Run"}
        </Button>
      </div>
      <FormError message={act.error ?? turnOff.error} />
      <AllowAllBuilders
        open={asking}
        onClose={() => setAsking(false)}
        reaches={lead.allowAllReaches}
        onTurnOn={() => allowAll(true)}
      />
    </li>
  );
}
