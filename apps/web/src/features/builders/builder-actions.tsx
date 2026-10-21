import type { SessionId } from "@courtyard/contract";
import { useEffect, useRef } from "react";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { answerApproval } from "../sessions/composer/messages.ts";
import { retryBuilder } from "./api.ts";

// A builder's actions that act in place (#592), the same on the Builders board's rows and on
// Home's Needs you: Allow on the approval it waits on, and Retry on one that's Stuck. On the board
// each is a pill at the end of its row; on Home, gold or red words in the row's first column.

/** How the action shows: a pill at a row's end (the board), or words (Home's Needs you). */
type Look = "pill" | "words";

/** Allow (#592): the approval the builder waits on is allowed, in one tap. */
export function Allow(props: {
  sessionId: SessionId;
  approval: number;
  /** What it allows, for its name: "Journey book wants to run gh pr checks --watch". */
  label: string;
  look: Look;
  onChanged: () => void;
}) {
  // Stops a kept answer's tries once the row has gone (answered on another device, say).
  const gone = useRef<AbortController>(undefined);
  useEffect(() => {
    const row = new AbortController();
    gone.current = row;
    return () => row.abort();
  }, []);
  const allow = useAction(async () => {
    const answered = await answerApproval({
      sessionId: props.sessionId,
      approval: props.approval,
      answer: "allow",
      onWaiting: () => {},
      signal: gone.current?.signal ?? new AbortController().signal,
    });
    if (answered.kind !== "loaded") return describeProblem(answered).body;
    props.onChanged();
    return undefined;
  });
  return (
    <>
      <Button
        variant={props.look === "pill" ? "needs" : "needsWords"}
        size={props.look === "pill" ? "row" : "words"}
        aria-label={`Allow: ${props.label}`}
        busy={allow.busy}
        busyLabel="Allowing…"
        onClick={() => void allow.run()}
      >
        Allow
      </Button>
      <FormError message={allow.error} />
    </>
  );
}

/** Retry (#592): a stuck builder carries on, in one tap. */
export function Retry(props: {
  sessionId: SessionId;
  /** The builder's name, for its button's. */
  name: string;
  look: Look;
  onChanged: () => void;
}) {
  const retry = useAction(async () => {
    const retried = await retryBuilder(props.sessionId);
    if (retried.kind !== "loaded") return describeProblem(retried).body;
    props.onChanged();
    return undefined;
  });
  return (
    <>
      <Button
        variant={props.look === "pill" ? "failedOutline" : "failedWords"}
        size={props.look === "pill" ? "row" : "words"}
        aria-label={`Retry ${props.name}`}
        busy={retry.busy}
        busyLabel="Retrying…"
        onClick={() => void retry.run()}
      >
        Retry
      </Button>
      <FormError message={retry.error} />
    </>
  );
}
