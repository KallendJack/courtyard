import { NeedsYou, type NeedYou } from "@courtyard/contract";
import { createKept, useKept } from "@courtyard/ui/layout/kept.tsx";
import { fromWorker } from "../../api/worker.ts";
import { builderName, wantsWords } from "../builders/words.ts";

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
 * stuck builder (#590) is only to look at, so it says what it is.
 */
export const NEED_WORDS: Readonly<Record<NeedYou["kind"], string>> = {
  approval: "Approve",
  "cut-off": "Continue",
  stuck: "Stuck",
  failed: "Review",
  reply: "Reply",
  merge: "Merge",
  conflict: "Bring up to date",
};

/**
 * What the owner does about a Lead's builder (#592), as the Builders board says it: Allow, Retry,
 * Review; else as any session's.
 */
const BUILDER_WORDS: Partial<Readonly<Record<NeedYou["kind"], string>>> = {
  approval: "Allow",
  stuck: "Retry",
  merge: "Review",
};

/** What the owner does about it, in a word or two, a builder's as the Builders board says it. */
export const needWords = (need: NeedYou) =>
  (need.builder === true ? BUILDER_WORDS[need.kind] : undefined) ?? NEED_WORDS[need.kind];

/** How a pull request stands, after its number and title. */
const PULL_WORDS = {
  failed: "checks failed",
  merge: "checks passed",
  conflict: "conflicts with its base",
} as const;

/**
 * What's waiting, in a few words: the session's title, or its pull request's number and title and
 * how it stands ("PR #412 · Quick questions, checks passed"); a Lead's builder by its issue's
 * name, as the Builders board says it (#592): "Journey book wants to run gh pr checks --watch",
 * "Ideas, ranked by value is Stuck: …", "Notify me is ready for review, checks passed".
 */
export const needTitle = (need: NeedYou) => {
  if (need.builder === true) {
    const name = builderName(need.session.title);
    if ("pullRequest" in need) {
      if (need.kind === "merge") return `${name} is ready for review, checks passed`;
    } else if (need.approval !== undefined) {
      return `${name} ${wantsWords(need.approval.ask)}`;
    } else if (need.kind === "stuck") {
      return need.reason === undefined ? `${name} is Stuck` : `${name} is Stuck: ${need.reason}`;
    }
  }
  return "pullRequest" in need
    ? `PR #${need.pullRequest.number} · ${need.pullRequest.title ?? need.session.title}, ${PULL_WORDS[need.kind]}`
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
