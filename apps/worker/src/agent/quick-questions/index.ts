import {
  type ChangedFile,
  type FailureReason,
  type ModelRef,
  type PullRequestFix,
  type PullRequestFixed,
  QUICK_LINES_MAX,
  type QuickAnswer,
  QuickLine,
  type QuickQuestions,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { getWorkspace } from "../../context/workspaces/index.ts";
import type { PullRequests, PullRequestsProblem } from "../../devflow/pull-requests/index.ts";
import { err, ok, type Result } from "../../result.ts";
import {
  fixFromQuestionsMessage,
  QUICK_QUESTIONS,
  QuickAnswerShape,
  quickQuestionMessage,
} from "../prompts/index.ts";
import { offerFor, type Provider } from "../providers/index.ts";

/**
 * Quick questions about a pull request (#327; docs/ai-conduct.md, Quick questions about a pull
 * request): a small read-only conversation on its page, whoever opened it. Each question is a
 * one-off question with no tools, so its model reads the pull request and changes nothing, and no
 * session, branch or worktree is involved. The conversations are kept in the worker's memory, the
 * latest `CONVERSATIONS_KEPT`. Fix it in a session carries one over to a session on its branch.
 */

/** Why a quick question wasn't answered, or a conversation couldn't be carried over. */
export type QuickQuestionsProblem =
  | { readonly kind: "pull-requests"; readonly problem: PullRequestsProblem }
  | { readonly kind: "model-unavailable" }
  /** A question about it is being answered already. */
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly reason: FailureReason }
  /** Fix it in a session, with nothing asked to carry over. */
  | { readonly kind: "nothing-asked" };

/** How many pull requests' conversations are kept; older ones go. */
const CONVERSATIONS_KEPT = 50;

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** The line numbers a file's diff shows of it as changed: its added lines and those around them. */
const shownLines = (patch: string | null) => {
  const shown = new Set<number>();
  let next: number | undefined;
  for (const line of patch?.split("\n") ?? []) {
    const header = HUNK.exec(line);
    if (header) {
      next = Number(header[1]);
      continue;
    }
    if (next === undefined || line.startsWith("-") || line.startsWith("\\")) continue;
    shown.add(next);
    next += 1;
  }
  return shown;
};

/** The model's answer as it's checked: the shape asked for, lines unchecked until they're kept. */
const Answered = z.object({ answer: z.string(), lines: z.array(z.unknown()) });

/** The lines an answer points at that its pull request's diff shows, each once, at most three. */
const linesShown = (raw: readonly unknown[], files: readonly ChangedFile[]) => {
  const kept: QuickLine[] = [];
  for (const one of raw) {
    const line = QuickLine.safeParse(one);
    if (!line.success) continue;
    const file = files.find((each) => each.path === line.data.path);
    if (file === undefined || !shownLines(file.patch).has(line.data.line)) continue;
    if (kept.some((each) => each.path === line.data.path && each.line === line.data.line)) {
      continue;
    }
    kept.push(line.data);
    if (kept.length === QUICK_LINES_MAX) break;
  }
  return kept;
};

export const createQuickQuestions = (options: {
  contextDir: string;
  providers: readonly Provider[];
  pullRequests: PullRequests;
}) => {
  const { pullRequests } = options;
  /** Each pull request's conversation, by its workspace and number, oldest first. */
  const kept = new Map<string, { model: ModelRef; asked: QuickAnswer[] }>();
  /** The pull requests a question is being answered about now. */
  const answering = new Set<string>();

  /** The key a pull request's conversation is kept by, or why its workspace has none. */
  const keyOf = async (
    rawId: string,
    number: number,
  ): Promise<Result<{ key: string; workspaceId: WorkspaceId }, QuickQuestionsProblem>> => {
    const workspace = await getWorkspace(options.contextDir, rawId);
    if (!workspace.ok) {
      return err({
        kind: "pull-requests",
        problem: { kind: "workspace", error: workspace.error },
      });
    }
    const workspaceId = workspace.value.summary.id;
    return ok({ key: `${workspaceId}#${number}`, workspaceId });
  };

  const shown = (key: string): QuickQuestions => {
    const conversation = kept.get(key);
    return { model: conversation?.model ?? null, asked: [...(conversation?.asked ?? [])] };
  };

  return {
    /** The questions asked about pull request `number` so far, and their answers. */
    of: async (rawId: string, number: number) => {
      const key = await keyOf(rawId, number);
      return key.ok ? ok(shown(key.value.key)) : key;
    },

    /**
     * Asks `model` a question about pull request `number`, with the questions before it, and
     * keeps it with its answer. It waits for the answer, so it can take a minute.
     */
    ask: async (ask: {
      rawId: string;
      number: number;
      text: string;
      model: ModelRef;
      signal: AbortSignal;
    }): Promise<Result<QuickQuestions, QuickQuestionsProblem>> => {
      const found = await keyOf(ask.rawId, ask.number);
      if (!found.ok) return found;
      const { key } = found.value;
      if (answering.has(key)) return err({ kind: "busy" });
      answering.add(key);
      try {
        const offer = await offerFor(options.providers, ask.model);
        if (offer === undefined) return err({ kind: "model-unavailable" });
        const review = await pullRequests.review(ask.rawId, ask.number);
        if (!review.ok) return err({ kind: "pull-requests", problem: review.error });
        const before = kept.get(key)?.asked ?? [];
        const answer = await offer.provider.answerOnce({
          purpose: "quick-question",
          model: ask.model.model,
          instructions: QUICK_QUESTIONS,
          message: quickQuestionMessage({
            review: review.value,
            asked: before,
            question: ask.text,
          }),
          schema: QuickAnswerShape,
          signal: ask.signal,
        });
        if (!answer.ok) return err({ kind: "failed", reason: answer.error });
        const answered = Answered.safeParse(answer.value);
        if (!answered.success || answered.data.answer.trim() === "") {
          return err({
            kind: "failed",
            reason: {
              kind: "unknown",
              message: "The model's answer came back in the wrong shape.",
            },
          });
        }
        const asked: QuickAnswer = {
          question: ask.text,
          answer: answered.data.answer.trim(),
          lines: linesShown(answered.data.lines, review.value.files),
        };
        // Asked again, it's the newest: Maps keep their order, so the first is the oldest.
        kept.delete(key);
        kept.set(key, { model: ask.model, asked: [...before, asked] });
        for (const [old] of kept) {
          if (kept.size <= CONVERSATIONS_KEPT) break;
          kept.delete(old);
        }
        return ok(shown(key));
      } finally {
        answering.delete(key);
      }
    },

    /**
     * Fix it in a session: the conversation about pull request `number` carried over to the
     * session on its branch, or to a new one there on `fix`'s model.
     */
    fix: async (
      rawId: string,
      number: number,
      fix: PullRequestFix,
    ): Promise<Result<PullRequestFixed, QuickQuestionsProblem>> => {
      const found = await keyOf(rawId, number);
      if (!found.ok) return found;
      const asked = kept.get(found.value.key)?.asked ?? [];
      if (asked.length === 0) return err({ kind: "nothing-asked" });
      const carried = await pullRequests.carryOver(rawId, number, {
        text: fixFromQuestionsMessage({ number, asked }),
        model: fix.model,
        ...(fix.effort === undefined ? {} : { effort: fix.effort }),
      });
      return carried.ok ? carried : err({ kind: "pull-requests", problem: carried.error });
    },
  };
};

export type QuickQuestionsKeeper = ReturnType<typeof createQuickQuestions>;
