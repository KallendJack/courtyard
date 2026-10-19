import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type CodeSessionList,
  STATUS_ITEM_MAX_LENGTH,
  StatusItem,
  type StatusLine,
  type StatusLineChange,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { STATUS_LINE, StatusLineAnswer, statusLineMessage } from "../../prompts/index.ts";
import { errandModel, type Provider } from "../../providers/index.ts";
import type { Background, StatusLineHooks } from "../sessions/index.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";

/**
 * The status line under a workspace's name (#256): ✓ just done · ● now · ○ next. A planning
 * workspace's is kept in the data folder (`status-line/<workspace>.json`), Courtyard's own state
 * rather than a change to the context folder, and changed by the owner's Done, Edit and Remove.
 */

/** A planning workspace's line as kept: each place's item, or none. */
const Kept = z.object({
  done: StatusItem.nullable().catch(null),
  now: StatusItem.nullable().catch(null),
  next: StatusItem.nullable().catch(null),
});
type Kept = z.infer<typeof Kept>;

const EMPTY: Kept = { done: null, now: null, next: null };

/** Why a status line couldn't be read or changed. */
export type StatusLineRefusal =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** Done or Remove on a place with nothing in it. */
  | { readonly kind: "empty" }
  /** A code workspace's line is built from its data: nothing on it is the owner's to change. */
  | { readonly kind: "not-editable" }
  | { readonly kind: "storage" };

/** The line after the owner's change. */
const changed = (line: Kept, change: StatusLineChange): Result<Kept, StatusLineRefusal> => {
  switch (change.kind) {
    case "done": {
      const ticked = line[change.place];
      if (ticked === null) return err({ kind: "empty" });
      return ok(
        change.place === "now"
          ? { done: ticked, now: line.next, next: null }
          : { ...line, done: ticked, next: null },
      );
    }
    case "edit":
      return ok({ ...line, [change.place]: { text: change.text, edited: true } });
    case "remove":
      if (line[change.place] === null) return err({ kind: "empty" });
      return ok({ ...line, [change.place]: null });
  }
};

/** A planning session's turn that ended, with the session's latest messages. */
type TurnEnded = Parameters<StatusLineHooks["turnEnded"]>[0];

/** How long the errand model may take over a line: a few words shouldn't take long. */
const ASKING_TIMEOUT_MS = 2 * 60 * 1000;

/** A model's item as the line gets it: on one line, without quotes or a full stop, cut to fit. */
const itemWords = (said: string) => {
  const words = said
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return words.length > STATUS_ITEM_MAX_LENGTH
    ? `${words.slice(0, STATUS_ITEM_MAX_LENGTH - 1).trimEnd()}…`
    : words;
};

/**
 * An issue's or pull request's title in product words: without what a session did to it ("Build
 * #256: "), the issue it closes ("(#256)"), or the ellipsis a session's title was cut with.
 */
const productWords = (title: string) =>
  itemWords(
    title
      .replace(/^(?:Build|Grill) #\d+: /, "")
      .replace(/\s*\(#\d+\)\s*$/, "")
      .replace(/…$/, ""),
  );

const sameWords = (a: string, b: string) =>
  a.localeCompare(b, "en-GB", { sensitivity: "base" }) === 0;

export const createStatusLine = (options: {
  contextDir: string;
  dataDir: string;
  providers: readonly Provider[];
  now: () => number;
  /** Runs work nobody waits for: moving a line along. */
  background: Background;
  /** What a code workspace's line is built from: its sessions, and its Next up. */
  code: {
    sessions: (workspaceId: WorkspaceId) => Promise<Result<CodeSessionList["sessions"], unknown>>;
    nextUp: (
      workspaceId: WorkspaceId,
    ) => Promise<Result<{ issues: readonly { title: string; ready: boolean }[] }, unknown>>;
  };
}) => {
  const { contextDir } = options;
  const folder = join(options.dataDir, "status-line");
  const fileOf = (workspaceId: WorkspaceId) => join(folder, `${workspaceId}.json`);
  /** Each workspace's last change to its kept line, so they happen one at a time. */
  const queues = new Map<WorkspaceId, Promise<unknown>>();

  const read = async (workspaceId: WorkspaceId): Promise<Kept> => {
    const kept = await readJsonFile(fileOf(workspaceId), Kept);
    return kept.ok && kept.value !== undefined ? kept.value : EMPTY;
  };

  /** Changes a workspace's kept line, after any change to it already under way. */
  const change = <E>(
    workspaceId: WorkspaceId,
    changing: (line: Kept) => Result<Kept, E | StatusLineRefusal>,
  ): Promise<Result<Kept, E | StatusLineRefusal>> => {
    const run = (queues.get(workspaceId) ?? Promise.resolve()).then(
      async (): Promise<Result<Kept, E | StatusLineRefusal>> => {
        const now = changing(await read(workspaceId));
        if (!now.ok) return now;
        try {
          await mkdir(folder, { recursive: true });
        } catch {
          return err({ kind: "storage" });
        }
        const written = await writeJsonFile(fileOf(workspaceId), now.value);
        return written.ok ? now : err({ kind: "storage" });
      },
    );
    queues.set(
      workspaceId,
      run.catch(() => undefined),
    );
    return run;
  };

  /** A planning workspace's id, or why its line can't be changed. */
  const planning = async (rawId: string): Promise<Result<WorkspaceId, StatusLineRefusal>> => {
    const workspace = await getWorkspace(contextDir, rawId);
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    const { summary } = workspace.value;
    return summary.mode === "code" ? err({ kind: "not-editable" }) : ok(summary.id);
  };

  /**
   * One short question to the errand model (docs/ai-conduct.md, The status line): the line as the
   * session's latest messages leave it. An item whose words it keeps stays as it was, the owner's
   * own words and all; a new one is the session's. Written only if the line is still as it read
   * it, so a change the owner made meanwhile wins.
   */
  const moveAlong = async (ended: TurnEnded) => {
    const { workspaceId, session } = ended;
    const workspace = await getWorkspace(contextDir, workspaceId);
    if (!workspace.ok || workspace.value.summary.mode === "code") return;
    const errand = await errandModel(options.providers);
    if (errand === undefined) return;
    const before = await read(workspaceId);
    const answered = await errand.provider.answerOnce({
      purpose: "status-line",
      model: errand.model,
      ...(errand.effort === undefined ? {} : { effort: errand.effort }),
      instructions: STATUS_LINE,
      message: statusLineMessage({
        now: options.now(),
        workspace: workspace.value.summary.name,
        contextFile: workspace.value.contextMarkdown,
        line: before,
        conversation: ended.conversation,
      }),
      schema: StatusLineAnswer,
      signal: AbortSignal.timeout(ASKING_TIMEOUT_MS),
    });
    const answer = answered.ok ? StatusLineAnswer.safeParse(answered.value) : undefined;
    if (!answer?.success) return;
    const at = new Date(options.now()).toISOString();
    const itemOf = (said: string | null): StatusItem | null => {
      const text = said === null ? "" : itemWords(said);
      if (text === "") return null;
      const kept = [before.done, before.now, before.next].find(
        (item) => item !== null && sameWords(item.text, text),
      );
      return kept ?? { text, from: { session, at } };
    };
    const line: Kept = {
      done: itemOf(answer.data.done),
      now: itemOf(answer.data.now),
      next: itemOf(answer.data.next),
    };
    await change(workspaceId, (was) =>
      JSON.stringify(was) === JSON.stringify(before) ? ok(line) : err({ kind: "moved" as const }),
    );
  };

  /** Each workspace's line being moved along now, and the next turn to move it from, if one ended meanwhile. */
  const moving = new Map<WorkspaceId, { next: TurnEnded | undefined }>();

  /** Moves a workspace's line along, one at a time, then from the latest turn that ended meanwhile. */
  const moveFrom = async (ended: TurnEnded) => {
    const state = { next: undefined as TurnEnded | undefined };
    moving.set(ended.workspaceId, state);
    try {
      let turn: TurnEnded | undefined = ended;
      while (turn !== undefined) {
        state.next = undefined;
        await moveAlong(turn);
        turn = state.next;
      }
    } finally {
      moving.delete(ended.workspaceId);
    }
  };

  /**
   * A code workspace's line, from its data with no model: ✓ the last pull request merged from one
   * of its sessions, ● the first build running now (not the Lead), ○ the first ready issue in Next
   * up, each in the product words of its title. Next up GitHub can't be asked for is left out.
   */
  const codeLine = async (workspaceId: WorkspaceId): Promise<StatusLine> => {
    const [sessions, nextUp] = await Promise.all([
      options.code.sessions(workspaceId),
      options.code.nextUp(workspaceId),
    ]);
    const listed = sessions.ok ? sessions.value : [];
    const merged = listed
      .filter((session) => session.pullRequest?.state === "merged")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const building = listed
      .filter((session) => session.busy && session.lead !== true)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const ready = nextUp.ok ? nextUp.value.issues.find((issue) => issue.ready) : undefined;
    const itemOf = (title: string | undefined): StatusItem | null => {
      const text = title === undefined ? "" : productWords(title);
      return text === "" ? null : { text };
    };
    return {
      done: itemOf(merged?.pullRequest?.title ?? merged?.title),
      now: itemOf(building?.title),
      next: itemOf(ready?.title),
      editable: false,
    };
  };

  return {
    /** A planning session's turn ended (#256): its workspace's line moves along, in the background. */
    turnEnded: (ended: TurnEnded) => {
      const already = moving.get(ended.workspaceId);
      if (already !== undefined) {
        already.next = ended;
        return;
      }
      options.background(
        moveFrom(ended).catch((error: unknown) =>
          console.error(`The ${ended.workspaceId} status line couldn't move along`, error),
        ),
      );
    },

    /** A workspace's status line now. */
    of: async (rawId: string): Promise<Result<StatusLine, StatusLineRefusal>> => {
      const workspace = await getWorkspace(contextDir, rawId);
      if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
      const { summary } = workspace.value;
      if (summary.mode === "code") return ok(await codeLine(summary.id));
      return ok({ ...(await read(summary.id)), editable: true });
    },

    /** The owner's Done, Edit or Remove: the line as it is then. */
    change: async (
      rawId: string,
      wanted: StatusLineChange,
    ): Promise<Result<StatusLine, StatusLineRefusal>> => {
      const workspaceId = await planning(rawId);
      if (!workspaceId.ok) return workspaceId;
      const line = await change(workspaceId.value, (was) => changed(was, wanted));
      return line.ok ? ok({ ...line.value, editable: true }) : line;
    },
  };
};

export type StatusLines = ReturnType<typeof createStatusLine>;
