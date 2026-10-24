import { join } from "node:path";
import {
  type BuildChange,
  type ChangeId,
  type DocumentChange,
  type LinePlace,
  type PlacedLine,
  type ProjectChange,
  RECENT_CHANGES_PAGE,
  type RecentChange,
  RecentChangeKind,
  type RecentChanges,
  type RecentChangeUndo,
  type SessionId,
  type ThingChange,
} from "@courtyard/contract";
import { exists, readTextFile, writeTextFile } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import {
  addContextLine,
  hasContextLine,
  labelledLines,
  removeContextLine,
} from "../context-file/index.ts";
import {
  type ContextFolder,
  type HistoryChange,
  type HistoryError,
  type Place,
  placeFile,
  stillAsLeft,
  type WholeFile,
  wholeFilesOf,
} from "../context-folder/index.ts";
import { documentChangeOf } from "../documents/index.ts";
import { buildChangeOf, isBuildChange } from "../fabrication/index.ts";
import { isProjectChange, projectChangeOf } from "../projects/index.ts";
import { titleOf } from "../saves/index.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { isThingChange, thingChangeOf } from "../things/index.ts";
import { undoWholeFileChange } from "./whole-files.ts";

/**
 * Recent changes (ADR 0013): what's changed in a workspace's context file or the owner context,
 * read from the context folder's history, and Undo from the list.
 */

/** Where Recent changes reads from and undoes in. */
export type ChangesTarget = {
  readonly contextDir: string;
  readonly contextFolder: ContextFolder;
  readonly sessions: Sessions;
};

/** Why Undo from Recent changes didn't happen. */
export type ChangeUndoRefusal =
  | { readonly kind: "not-found" }
  /** Only a save, a hand edit or a tidy can be undone from the list. */
  | { readonly kind: "not-undoable" }
  /** A line the change touched has changed since. */
  | { readonly kind: "changed-since" }
  /** A document the change wrote or removed has changed since. */
  | { readonly kind: "document-changed-since" }
  /** A Thing the change wrote or removed has changed since. */
  | { readonly kind: "thing-changed-since" }
  /** A project (#603) or a Build (#697) the change wrote has changed since. */
  | { readonly kind: "project-changed-since" }
  | { readonly kind: "build-changed-since" }
  /** A file a move wrote or removed has changed since (#603). */
  | { readonly kind: "move-changed-since" }
  /** A save is undone through its session, which refused. */
  | { readonly kind: "session"; readonly error: SessionError }
  | { readonly kind: "storage" };

/** The lines a change took out of a file and what it put in. */
type LinesChanged = { readonly removed: PlacedLine[]; readonly added: PlacedLine[] };

/** Which kind of file a place's file is, as its lines are read. */
const linePlaceOf = (place: Place): LinePlace =>
  place.kind === "owner-context" ? "owner" : "workspace";

/** The kinds of change made file by file, which Recent changes undoes file by file. */
const WHOLE_FILE_KINDS: ReadonlySet<HistoryChange["kind"]> = new Set([
  "document",
  "thing",
  "project",
  "build",
  "move",
]);

/** Whether a change is undone line by line: a hand edit or a tidy, which no session holds. */
const undoneByLines = (change: HistoryChange) =>
  change.kind === "hand-edit" || change.kind === "tidy";

const sameLine = (a: PlacedLine, b: PlacedLine) =>
  a.place === b.place && a.section === b.section && a.line === b.line;

/** The lines in `from` that aren't in `without`, each line counted as often as it's there. */
const linesNotIn = (from: readonly PlacedLine[], without: readonly PlacedLine[]) => {
  const left = [...without];
  return from.filter((line) => {
    const index = left.findIndex((other) => sameLine(other, line));
    if (index !== -1) left.splice(index, 1);
    return index === -1;
  });
};

/** The lines a change took out of a place's file and put in. Lines that only moved don't count. */
const linesChanged = (
  files: { before: string | null; after: string | null },
  place: Place,
): LinesChanged => {
  const lines = (markdown: string | null) =>
    markdown === null
      ? []
      : labelledLines(markdown, linePlaceOf(place)).map(({ label: _, ...line }) => line);
  const was = lines(files.before);
  const now = lines(files.after);
  return { removed: linesNotIn(was, now), added: linesNotIn(now, was) };
};

/** What each change did to a place's file, read from the history in one go. */
const changesTo = async (
  folder: ContextFolder,
  wanted: readonly { change: ChangeId; place: Place }[],
): Promise<Result<LinesChanged[], HistoryError>> => {
  const files = await folder.filesAt(
    wanted.flatMap(({ change, place }) => [
      { change, before: true, path: placeFile(place) },
      { change, path: placeFile(place) },
    ]),
  );
  if (!files.ok) return files;
  return ok(
    wanted.map(({ place }, index) =>
      linesChanged(
        { before: files.value[index * 2] ?? null, after: files.value[index * 2 + 1] ?? null },
        place,
      ),
    ),
  );
};

/**
 * A file with a change's lines reversed: what it put in taken out, what it took out put back.
 * `undefined` when a line it put in isn't there as it was, or one it took out is back already.
 */
const reversed = (markdown: string, change: LinesChanged) => {
  let now: string | undefined = markdown;
  for (const line of change.added) now = now === undefined ? now : removeContextLine(now, line);
  if (now === undefined || change.removed.some((line) => hasContextLine(now ?? "", line))) {
    return undefined;
  }
  return change.removed.reduce(addContextLine, now);
};

/** A place's file as it is now, `""` when it isn't there. */
const fileNow = async (contextDir: string, place: Place) => {
  const read = await readTextFile(join(contextDir, placeFile(place)));
  return read.ok ? ok(read.value ?? "") : err("storage" as const);
};

/** Each session, read once however many changes come from it: `undefined` once deleted. */
const sessionsRead = (sessions: Sessions) => {
  const read = new Map<SessionId, ReturnType<Sessions["get"]>>();
  return async (session: SessionId) => {
    const summary = read.get(session) ?? sessions.get(session);
    read.set(session, summary);
    const found = await summary;
    return found.ok ? found.value : undefined;
  };
};

/** Each session's saves, read once however many changes come from it. */
const sessionSaves = (sessions: Sessions) => {
  const read = new Map<SessionId, ReturnType<Sessions["savesOf"]>>();
  return (session: SessionId) => {
    const saves = read.get(session) ?? sessions.savesOf(session);
    read.set(session, saves);
    return saves;
  };
};

/**
 * The save a change made, in its session, by its event number: the save recorded with the
 * change's id, or, for saves recorded before ids were, the latest one with the change's title
 * that isn't undone. `undefined` when its session or the save is gone.
 */
const saveMadeBy = async (savesOf: ReturnType<typeof sessionSaves>, change: HistoryChange) => {
  if (change.kind !== "save" || change.session === undefined) return undefined;
  const saves = await savesOf(change.session);
  if (!saves.ok) return undefined;
  const recorded = saves.value.find((save) => save.change === change.id);
  if (recorded !== undefined) return recorded;
  const titled = saves.value.filter(
    (save) => save.change === undefined && titleOf(save.state.save) === change.title,
  );
  return titled.findLast(({ state }) => !state.undone) ?? titled.at(-1);
};

/**
 * One page of a place's Recent changes, newest first, after the change `after` when it's given.
 * A change that only moved lines, or changed what isn't a line (the intro, say), isn't listed.
 * A hand edit or a tidy offers Undo only while its lines are as it left them, and shows as undone
 * once its undo is in the history.
 */
export const listChanges = async (
  target: ChangesTarget,
  query: { place: Place; after?: ChangeId },
): Promise<Result<RecentChanges, HistoryError>> => {
  const { contextFolder, contextDir, sessions } = target;
  const history = await contextFolder.history({ ...query, limit: RECENT_CHANGES_PAGE });
  if (!history.ok) return history;
  const { changes, more } = history.value;
  const lines = await changesTo(
    contextFolder,
    changes.map(({ id }) => ({ change: id, place: query.place })),
  );
  if (!lines.ok) return lines;
  const now = await fileNow(contextDir, query.place);
  if (!now.ok) return now;
  const undone = await contextFolder.undone();
  if (!undone.ok) return undone;
  const savesOf = sessionSaves(sessions);
  const sessionOf = sessionsRead(sessions);
  const wholeFiles = await wholeFilesOf(contextFolder, changes);
  if (!wholeFiles.ok) return wholeFiles;

  /**
   * What a change to whole files did to a document or a Thing, and whether Undo is offered for
   * it: only while each file is as it left it.
   */
  const wholeFileEntry = async (
    change: HistoryChange,
    files: readonly WholeFile[],
  ): Promise<
    Result<
      | { document: DocumentChange; undo: RecentChangeUndo }
      | { thing: ThingChange; undo: RecentChangeUndo }
      | { project: ProjectChange; undo: RecentChangeUndo }
      | { build: BuildChange; undo: RecentChangeUndo }
      | { move: { title: string }; undo: RecentChangeUndo },
      HistoryError
    >
  > => {
    const now = await stillAsLeft(contextDir, files);
    if (!now.ok) return err("storage");
    const undo: RecentChangeUndo = !WHOLE_FILE_KINDS.has(change.kind)
      ? "none"
      : undone.value.has(change.id)
        ? "undone"
        : now.value
          ? "available"
          : "none";
    // A move the owner ticked (#603) may touch any of the workspace's files: it's listed by its words.
    if (change.kind === "move") {
      return ok({ move: { title: change.title.replace(/^Move: /, "") }, undo });
    }
    const made = isBuildChange(files)
      ? buildChangeOf(files)
      : isProjectChange(files)
        ? projectChangeOf(files)
        : isThingChange(files)
          ? thingChangeOf(files)
          : documentChangeOf(files);
    const there = made.path === null ? undefined : await exists(join(contextDir, made.path));
    if (there !== undefined && !there.ok) return err("storage");
    if ("build" in made) {
      return ok({ build: { ...made.build, slug: there?.value ? made.build.slug : null }, undo });
    }
    if ("project" in made) {
      return ok({
        project: { ...made.project, slug: there?.value ? made.project.slug : null },
        undo,
      });
    }
    if ("thing" in made) {
      return ok({ thing: { ...made.thing, slug: there?.value ? made.thing.slug : null }, undo });
    }
    return ok({
      document: { ...made.document, slug: there?.value ? made.document.slug : null },
      undo,
    });
  };

  const undoOf = async (
    change: HistoryChange,
    changed: LinesChanged,
  ): Promise<RecentChangeUndo> => {
    if (undoneByLines(change)) {
      if (undone.value.has(change.id)) return "undone";
      return reversed(now.value, changed) === undefined ? "none" : "available";
    }
    const made = await saveMadeBy(savesOf, change);
    if (made === undefined) return "none";
    return made.state.undone ? "undone" : "available";
  };

  const listed = await Promise.all(
    changes.map(async (change, index): Promise<Result<RecentChange[], HistoryError>> => {
      const kind = RecentChangeKind.safeParse(change.kind);
      const changed = lines.value[index];
      const files = wholeFiles.value[index] ?? [];
      if (!kind.success || changed === undefined) return ok([]);
      const whole = files.length === 0 ? undefined : await wholeFileEntry(change, files);
      if (whole !== undefined && !whole.ok) return whole;
      if (whole === undefined && changed.removed.length === 0 && changed.added.length === 0) {
        return ok([]);
      }
      const session = change.session === undefined ? undefined : await sessionOf(change.session);
      return ok([
        {
          id: change.id,
          kind: kind.data,
          at: change.at,
          ...(session === undefined
            ? {}
            : {
                session: {
                  id: session.id,
                  title: session.title,
                  workspaceId: session.workspaceId,
                },
              }),
          ...changed,
          ...(whole === undefined ? { undo: await undoOf(change, changed) } : whole.value),
        },
      ]);
    }),
  );
  const failed = listed.find((entry) => !entry.ok);
  if (failed !== undefined && !failed.ok) return failed;
  return ok({ changes: listed.flatMap((entry) => (entry.ok ? entry.value : [])), more });
};

/** Undoes a hand edit or a tidy, as a change of its own: each place's lines it changed, reversed. */
const undoLines = async (
  target: ChangesTarget,
  change: HistoryChange,
): Promise<Result<null, ChangeUndoRefusal>> => {
  const changed = await changesTo(
    target.contextFolder,
    change.places.map((place) => ({ change: change.id, place })),
  );
  if (!changed.ok) return err({ kind: "storage" });
  const places = change.places.flatMap((place, index) => {
    const lines = changed.value[index];
    if (lines === undefined || (lines.removed.length === 0 && lines.added.length === 0)) return [];
    return [{ place, lines }];
  });
  if (places.length === 0) return err({ kind: "not-undoable" });
  return target.contextFolder.change(
    async (): Promise<Result<null, ChangeUndoRefusal>> => {
      const writes: { path: string; markdown: string }[] = [];
      for (const { place, lines } of places) {
        const now = await fileNow(target.contextDir, place);
        if (!now.ok) return err({ kind: "storage" });
        const markdown = reversed(now.value, lines);
        if (markdown === undefined) return err({ kind: "changed-since" });
        writes.push({ path: join(target.contextDir, placeFile(place)), markdown });
      }
      for (const { path, markdown } of writes) {
        const written = await writeTextFile(path, markdown);
        if (!written.ok) return err({ kind: "storage" });
      }
      return ok(null);
    },
    () => ({
      kind: "undo",
      title: `Undo: ${change.title}`,
      places: change.places,
      undoes: change.id,
    }),
  );
};

/**
 * Undoes a change from Recent changes. A save is undone through its session, the same as its
 * note's Undo, so the note shows it and the model knows. A hand edit or a tidy is reversed line by
 * line.
 */
export const undoChange = async (
  target: ChangesTarget,
  id: ChangeId,
): Promise<Result<null, ChangeUndoRefusal>> => {
  const found = await target.contextFolder.changeOf(id);
  if (!found.ok) return err({ kind: "storage" });
  const change = found.value;
  if (change === undefined) return err({ kind: "not-found" });
  if (WHOLE_FILE_KINDS.has(change.kind)) return undoWholeFileChange(target, change);
  if (undoneByLines(change)) {
    const undone = await target.contextFolder.undone();
    if (!undone.ok) return err({ kind: "storage" });
    return undone.value.has(change.id) ? err({ kind: "not-undoable" }) : undoLines(target, change);
  }
  const made = await saveMadeBy(sessionSaves(target.sessions), change);
  if (made === undefined || change.session === undefined) return err({ kind: "not-undoable" });
  const undone = await target.sessions.undoSave({ rawId: change.session, save: made.seq });
  return undone.ok ? undone : err({ kind: "session", error: undone.error });
};
