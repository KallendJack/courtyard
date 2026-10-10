import type { ApprovalAnswer, ApprovalAsk } from "@courtyard/contract";
import { useState } from "react";
import { addStylesheet } from "@/lib/stylesheet";
import css from "./approval-card.css?inline";
import { CapsLabel } from "./caps-label.tsx";
import { FormError } from "./form-error.tsx";
import { ThumbButton } from "./thumb-button.tsx";

// The card's own stylesheet (approval-card.css), added once, when a session page first loads.
addStylesheet("approval-card", css);

/** What the card asks, in a few words: its title. */
const question = (ask: ApprovalAsk) => {
  if (ask.kind === "edit") return "Change a file outside the worktree?";
  if (ask.kind === "setup") return "Change how commands run?";
  return ask.reason === "off-allowlist"
    ? "Run a command? It isn't on the allowlist."
    : "Run a command? It names a path outside the worktree.";
};

/** What the model said it's for, as a sentence, and what Deny does. */
const whyLine = (why: string | undefined) => {
  const deny = "Deny and it will find another way.";
  const said = why?.trim();
  if (!said) return deny;
  return `${said}${/[.!?]$/.test(said) ? "" : "."} ${deny}`;
};

/**
 * An approval a code session's turn waits on (#171): gold, since it needs the owner, with the
 * exact command (or file), what the model said it's for, and Deny and Allow at the bottom, in
 * thumb reach, one tap each (the shared thumb buttons, Allow wider). Its classes are in its own
 * stylesheet, off the first load.
 */
export function ApprovalCard(props: {
  ask: ApprovalAsk;
  why: string | undefined;
  /** Sends the owner's answer: what went wrong, or nothing once it's sent. */
  onAnswer: (answer: ApprovalAnswer) => Promise<string | undefined>;
}) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const answer = async (given: ApprovalAnswer) => {
    setSending(true);
    const failed = await props.onAnswer(given);
    setProblem(failed);
    // Once answered, the card goes with the answer's event; until then it can be answered again.
    if (failed !== undefined) setSending(false);
  };
  const exact = props.ask.kind === "command" ? props.ask.command : props.ask.path;
  return (
    // Where the card's own classes apply (approval-card.css).
    <div data-approval-card="">
      <section
        aria-label="Needs your OK"
        className="flex flex-col gap-3 rounded-ask bg-surface p-4.5 ring-[1.5px] ring-warning/55 ring-inset"
      >
        <CapsLabel tone="warning">Needs your OK</CapsLabel>
        <h2 className="display-section text-[19px]/6 tracking-[-0.015em] text-foreground">
          {question(props.ask)}
        </h2>
        <div className="rounded-bubble bg-card px-3.5 py-3 ring-1 ring-border ring-inset">
          <code className="font-mono text-sm/5 wrap-anywhere whitespace-pre-wrap text-foreground">
            {exact}
          </code>
        </div>
        <p className="text-xs/[19px] text-muted-foreground">{whyLine(props.why)}</p>
        <FormError message={problem} />
        <div className="mt-3 flex gap-2.5">
          <ThumbButton look="quiet" tall disabled={sending} onClick={() => void answer("deny")}>
            Deny
          </ThumbButton>
          <ThumbButton
            look="main"
            grow={1.4}
            tall
            disabled={sending}
            onClick={() => void answer("allow")}
          >
            Allow
          </ThumbButton>
        </div>
      </section>
    </div>
  );
}
