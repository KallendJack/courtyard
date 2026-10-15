import type { AlwaysAllow, AlwaysFor, ApprovalAnswer, ApprovalAsk } from "@courtyard/contract";
import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { alwaysWords } from "@/lib/always-words";
import { addStylesheet } from "@/lib/stylesheet";
import type { Waiting } from "../patience.ts";
import { describeProblem } from "../problems.tsx";
import css from "./approval-card.css?inline";
import { Button } from "./button.tsx";
import { CapsLabel } from "./caps-label.tsx";
import { FormError } from "./form-error.tsx";
import { StatusPill } from "./notice.tsx";
import { ThumbButton } from "./thumb-button.tsx";

// The card's own stylesheet (approval-card.css), added once, when a page first shows one.
addStylesheet("approval-card", css);

/** What the card asks, in a few words: its title. */
const question = (ask: ApprovalAsk) => {
  if (ask.kind === "edit") return "Change a file outside the worktree?";
  if (ask.kind === "setup") return "Change how commands run?";
  if (ask.kind === "tool") return `Delete something in ${ask.connection} this session didn't make?`;
  switch (ask.reason) {
    case "off-allowlist":
      return "Run a command? It isn't on the allowlist.";
    case "reaches-out":
      return "Run a command? It names a path outside the worktree.";
    case "ignored-folder":
      return "Run a command? It runs in a folder git ignores (downloaded or built files).";
  }
};

/** Exactly what would happen: the command, the file, or the tool connection's action and input. */
const exactly = (ask: ApprovalAsk) => {
  switch (ask.kind) {
    case "command":
      return ask.command;
    case "edit":
    case "setup":
      return ask.path;
    case "tool":
      return `${ask.action} ${ask.input}`;
  }
};

/** What the model said it's for, as a sentence, and what Deny does: a helper reports back (#117). */
const whyLine = (why: string | undefined, helper: string | undefined) => {
  const deny =
    helper === undefined
      ? "Deny and it will find another way."
      : "Deny and the helper reports back without them.";
  const said = why?.trim();
  if (!said) return deny;
  return `${said}${/[.!?]$/.test(said) ? "" : "."} ${deny}`;
};

/** The answer on its way: Deny, Allow, or Allow always for the session or the workspace. */
type Sending = ApprovalAnswer | AlwaysFor;

/**
 * What an approval a code session's turn waits on says (#171): its title, the exact command, file
 * or tool connection's action, and why. One a helper asks for names it (#117).
 */
export const approvalWords = (approval: {
  ask: ApprovalAsk;
  why: string | undefined;
  /** The name of the helper asking, or none for the model itself. */
  helper: string | undefined;
}) => ({
  title: question(approval.ask),
  exact: exactly(approval.ask),
  note: whyLine(approval.why, approval.helper),
  ...(approval.helper === undefined
    ? {}
    : { label: `Needs your OK · Helper · ${approval.helper}` }),
});

/**
 * Something that needs the owner's OK: an approval a code session's turn waits on (#171,
 * `approvalWords`), or the setup check's offer (#181). Gold, since it needs the owner, with the
 * exact command, file, tool connection's action or list, a line on what it's for, and Deny and
 * Allow at the bottom, in thumb reach, one tap each (the shared thumb buttons, Allow wider). Its
 * classes are in its own stylesheet, off the first load.
 */
export function ApprovalCard(props: {
  title: string;
  exact: string;
  note: string;
  /** Its label above the title: "Needs your OK" unless it says, such as a helper's (#117). */
  label?: string;
  /** What Deny is called here: "Deny" unless it says. */
  denyLabel?: string;
  /**
   * What Allow always would allow (#185), when the approval offers it: a row under Deny and Allow
   * saying exactly that, with This session and This workspace.
   */
  always?: AlwaysAllow | undefined;
  /**
   * Opens Allow all for this task's choice of how long (#428), when Allow all would cover this
   * approval: a quiet line at the card's foot.
   */
  onAllowAll?: (() => void) | undefined;
  /**
   * Sends the owner's answer, allowed always for the session or the workspace when they tapped
   * one of those: what went wrong, or nothing once it's sent. One that waits for a slow worker
   * says so through `onWaiting`, and stops when `signal` says the card has gone (#204).
   */
  onAnswer: (
    answer: ApprovalAnswer,
    waiting: { onWaiting: (waiting: Waiting) => void; signal: AbortSignal },
    always?: AlwaysFor,
  ) => Promise<string | undefined>;
}) {
  /** The answer on its way: its button shows it's working, the others wait (#330). */
  const [sending, setSending] = useState<Sending>();
  const [problem, setProblem] = useState<string>();
  const [waiting, setWaiting] = useState<Waiting>();
  // Stops a kept answer's tries once the card has gone (answered on another device, say).
  const gone = useRef<AbortController>(undefined);
  useEffect(() => {
    const card = new AbortController();
    gone.current = card;
    return () => card.abort();
  }, []);
  const answer = async (given: Sending) => {
    setSending(given);
    setProblem(undefined);
    const { signal } = gone.current ?? new AbortController();
    const waiting = { onWaiting: setWaiting, signal };
    const failed =
      given === "allow" || given === "deny"
        ? await props.onAnswer(given, waiting)
        : await props.onAnswer("allow", waiting, given);
    if (signal.aborted) return;
    setWaiting(undefined);
    setProblem(failed);
    // Once answered, the card goes with the answer's event; until then it can be answered again.
    if (failed !== undefined) setSending(undefined);
  };
  return (
    // Where the card's own classes apply (approval-card.css).
    <div data-approval-card="">
      <section
        aria-label="Needs your OK"
        className="flex flex-col gap-3 rounded-ask bg-surface p-4.5 ring-stroke ring-warning/55 ring-inset"
      >
        <CapsLabel tone="warning">{props.label ?? "Needs your OK"}</CapsLabel>
        <h2 className="display-section text-card-title tracking-[-0.015em] text-foreground">
          {props.title}
        </h2>
        <div className="rounded-bubble bg-card px-3.5 py-3 ring-1 ring-border ring-inset">
          <code className="font-mono text-sm/5 wrap-anywhere whitespace-pre-wrap text-foreground">
            {props.exact}
          </code>
        </div>
        <p className="text-meta/4.75 text-muted-foreground">{props.note}</p>
        {waiting === "slow" ? (
          <StatusPill>Waiting for Courtyard…</StatusPill>
        ) : (
          <FormError
            message={
              waiting === "unreachable"
                ? `${describeProblem({ kind: "offline" }).body} Your answer goes once it's back.`
                : problem
            }
          />
        )}
        <div className="mt-3 flex gap-2.5">
          <ThumbButton
            look="quiet"
            tall
            busy={sending === "deny"}
            busyLabel="Sending…"
            waiting={sending !== undefined && sending !== "deny"}
            onClick={() => void answer("deny")}
          >
            {props.denyLabel ?? "Deny"}
          </ThumbButton>
          <ThumbButton
            look="main"
            grow={1.4}
            tall
            busy={sending === "allow"}
            busyLabel="Allowing…"
            waiting={sending !== undefined && sending !== "allow"}
            onClick={() => void answer("allow")}
          >
            Allow
          </ThumbButton>
        </div>
        {props.always !== undefined && (
          <AllowAlways
            words={alwaysWords(props.always)}
            sending={sending}
            onAnswer={(always) => void answer(always)}
          />
        )}
        {props.onAllowAll !== undefined && (
          <div className="self-center">
            <Button
              variant="quiet"
              size="xs"
              disabled={sending !== undefined}
              onClick={props.onAllowAll}
            >
              <Clock aria-hidden />
              Allow all for this task…
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Allow always (#185; Paper, "Tablet · Approval with Allow always"): under Deny and Allow, a line
 * saying exactly what it would allow, "Always allow `pnpm add …`", between two gold rules, and This
 * session and This workspace, one tap each.
 */
function AllowAlways(props: {
  words: string;
  sending: Sending | undefined;
  onAnswer: (always: AlwaysFor) => void;
}) {
  const choices = [
    { always: "session", label: "This session" },
    { always: "workspace", label: "This workspace" },
  ] as const;
  return (
    <fieldset aria-label={`Always allow ${props.words}`} className="flex min-w-0 flex-col gap-3">
      <p className="flex items-center gap-2.5 text-meta text-muted-foreground before:h-px before:min-w-4 before:grow before:bg-warning/25 after:h-px after:min-w-4 after:grow after:bg-warning/25">
        <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
          Always allow{" "}
          <code className="rounded-sm bg-card px-1.5 py-0.5 font-mono text-meta font-bold wrap-anywhere text-foreground">
            {props.words}
          </code>
        </span>
      </p>
      <div className="flex gap-2.5">
        {choices.map(({ always, label }) => (
          <ThumbButton
            key={always}
            look="ringed"
            low
            busy={props.sending === always}
            busyLabel="Allowing…"
            waiting={props.sending !== undefined && props.sending !== always}
            onClick={() => props.onAnswer(always)}
          >
            {label}
          </ThumbButton>
        ))}
      </div>
    </fieldset>
  );
}
