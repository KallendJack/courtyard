import { NeedsYou, type NeedYou } from "@courtyard/contract";
import { createKept, useKept } from "@/components/layout/kept";
import { fromWorker } from "../../api/worker.ts";

// Everything waiting on the owner, in every workspace (#492), as the worker decided it: the
// Courtyard mark's count, Home's Needs you and a session's Next pill all read this one store, so
// they always agree. No styles, so the frame can ask without Home's.

/** What waits, as last known, for the tab's lifetime (nothing jumps in late). */
const KEPT_NEEDS = createKept<NeedsYou>();

/** How often it asks again while a turn runs anywhere, so an approval or a reply shows soon. */
const BUSY_EVERY_MS = 3000;

/**
 * What waits on the owner as last known, asked for again when `again` changes (a move to another
 * page), and kept fresh the shared way, faster while a turn runs anywhere; nothing is asked while
 * `asking` is false (reading the device's copy, #106).
 */
export const useNeedsYou = (again?: unknown, asking = true) =>
  useKept(KEPT_NEEDS, {
    key: "all",
    load: async () => {
      const loaded = await fromWorker("/needs-you", NeedsYou);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    ...(again === undefined ? {} : { again }),
    asking,
    busy: (known) => (known.busy ? BUSY_EVERY_MS : undefined),
  });

/**
 * What the owner does about it, in a word or two: Needs you's label, and the Next pill's. A
 * stalled builder (#474) is only to look at, so it says what it is, as does one stopped with no
 * pull request (#541).
 */
export const NEED_WORDS: Readonly<Record<NeedYou["kind"], string>> = {
  asked: "Answer",
  "turn-failed": "Continue",
  stopped: "Stopped, no PR",
  approval: "Approve",
  "cut-off": "Continue",
  stalled: "Stalled",
  failed: "Review",
  reply: "Reply",
  merge: "Merge",
  conflict: "Bring up to date",
};

/** How a pull request stands, after its number and title. */
const PULL_WORDS = {
  failed: "checks failed",
  merge: "checks passed",
  conflict: "conflicts with its base",
} as const;

/**
 * What's waiting, in a few words: the session's title, with the question it asked (#541); or its
 * pull request's number and title and how it stands ("PR #412 · Quick questions, checks passed").
 */
export const needTitle = (need: NeedYou) => {
  if ("pullRequest" in need) {
    return `PR #${need.pullRequest.number} · ${need.pullRequest.title ?? need.session.title}, ${PULL_WORDS[need.kind]}`;
  }
  return need.kind === "asked"
    ? `${need.session.title}: ${need.question.text}`
    : need.session.title;
};

/**
 * Where a tap on it goes: its session's page, or for its pull request, the session's review of it.
 */
export const needLink = (need: NeedYou) => ({
  to: "/workspaces/$workspaceId/sessions/$sessionId" as const,
  params: { workspaceId: need.workspace.id, sessionId: need.session.id },
  ...("pullRequest" in need ? { search: { view: "review" as const } } : {}),
});
