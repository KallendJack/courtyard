import { join } from "node:path";
import {
  type ChangeId,
  type LinePlace,
  type PlacedLine,
  RECENT_CHANGES_PAGE,
  type RecentChange,
  RecentChangeKind,
  type RecentChanges,
  type RecentChangeUndo,
} from "@courtyard/contract";
import {
  addContextLine,
  hasContextLine,
  labelledLines,
  removeContextLine,
} from "../context-file/index.ts";
import type { ContextFolder, HistoryChange, Place } from "../context-folder/index.ts";
import { readTextFile, writeTextFile } from "../files.ts";
import { OWNER_FILE } from "../owner-context/index.ts";
import { err, ok, type Result } from "../result.ts";
import { titleOf } from "../saves/index.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { CONTEXT_FILE } from "../workspaces/index.ts";

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
  /** Only a save or a hand edit can be undone from the list. */
  | { readonly kind: "not-undoable" }
  /** A line the change touched has changed since. */
  | { readonly kind: "changed-since" }
  /** A save is undone through its session, which refused. */
  | { readonly kind: "session"; readonly error: SessionError }
  | { readonly kind: "storage" };

/** A place's file, by its path from the context folder's top. */
const pathOf = (place: Place) =>
  place.kind === "owner-context" ? OWNER_FILE : `${place.id}/${CONTEXT_FILE}`;

/** Which kind of file a place's file is, as its lines are read. */
const linePlaceOf = (place: Place): LinePlace =>
  place.kind === "owner-context" ? "owner" : "workspace";

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

/** The lines a change took out of a file and put in. Lines that only moved don't count. */
const linesChanged = (files: { before: string | null; after: string | null }, place: LinePlace) => {
  const lines = (markdown: string | null) =>
    markdown === null ? [] : labelledLines(markdown, place).map(({ label: _, ...line }) => line);
  const was = lines(files.before);
  const now = lines(files.after);
  return { removed: linesNotIn(was, now), added: linesNotIn(now, was) };
};

/**
 * The save a change made, in its session, by its event number: matched by the change's title,
 * the latest one not undone first. `undefined` when its session or the save is gone.
 */
const saveMadeBy = async (sessions: Sessions, change: HistoryChange) => {
  if (change.kind !== "save" || change.session === undefined) return undefined;
  const saves = await sessions.savesOf(change.session);
  if (!saves.ok) return undefined;
  const made = saves.value.filter(({ state }) => titleOf(state.save) === change.title);
  return made.findLast(({ state }) => !state.undone) ?? made.at(-1);
};

const undoOf = async (sessions: Sessions, change: HistoryChange): Promise<RecentChangeUndo> => {
  if (change.kind === "hand-edit") return "available";
  const made = await saveMadeBy(sessions, change);
  if (made === undefined) return "none";
  return made.state.undone ? "undone" : "available";
};

/**
 * One page of a place's Recent changes, newest first, after the change `after` when it's given.
 * A change that touched none of the place's lines (a hand edit to another file, say) isn't
 * listed.
 */
export const listChanges = async (
  target: ChangesTarget,
  query: { place: Place; after?: ChangeId },
): Promise<Result<RecentChanges, "unknown-change">> => {
  const history = await target.contextFolder.history({ ...query, limit: RECENT_CHANGES_PAGE });
  if (!history.ok) return history;
  const path = pathOf(query.place);
  const { changes, more } = history.value;
  const files = await target.contextFolder.filesAt(
    changes.flatMap(({ id }) => [
      { change: id, before: true, path },
      { change: id, path },
    ]),
  );
  const listed = await Promise.all(
    changes.map(async (change, index): Promise<RecentChange[]> => {
      const kind = RecentChangeKind.safeParse(change.kind);
      if (!kind.success) return [];
      const before = files[index * 2] ?? null;
      const after = files[index * 2 + 1] ?? null;
      const { removed, added } = linesChanged({ before, after }, linePlaceOf(query.place));
      if (removed.length === 0 && added.length === 0) return [];
      return [
        {
          id: change.id,
          kind: kind.data,
          at: change.at,
          ...(change.session === undefined ? {} : { session: change.session }),
          removed,
          added,
          undo: await undoOf(target.sessions, change),
        },
      ];
    }),
  );
  return ok({ changes: listed.flat(), more });
};

/**
 * A file with a change's lines reversed: what it put in taken out, what it took out put back.
 * `undefined` when a line it put in isn't there as it was, or one it took out is back already.
 */
const reversed = (markdown: string, change: { removed: PlacedLine[]; added: PlacedLine[] }) => {
  let now: string | undefined = markdown;
  for (const line of change.added) now = now === undefined ? now : removeContextLine(now, line);
  if (now === undefined || change.removed.some((line) => hasContextLine(now ?? "", line))) {
    return undefined;
  }
  return change.removed.reduce(addContextLine, now);
};

/** Undoes a hand edit, as a change of its own: each place's lines it changed, reversed. */
const undoHandEdit = async (
  target: ChangesTarget,
  change: HistoryChange,
): Promise<Result<null, ChangeUndoRefusal>> => {
  const places = change.places.map((place) => ({ place, path: pathOf(place) }));
  const files = await target.contextFolder.filesAt(
    places.flatMap(({ path }) => [
      { change: change.id, before: true, path },
      { change: change.id, path },
    ]),
  );
  const changed = places.map(({ place, path }, index) => ({
    path,
    lines: linesChanged(
      { before: files[index * 2] ?? null, after: files[index * 2 + 1] ?? null },
      linePlaceOf(place),
    ),
  }));
  return target.contextFolder.change(
    async (): Promise<Result<null, ChangeUndoRefusal>> => {
      const writes: { path: string; markdown: string }[] = [];
      for (const { path, lines } of changed) {
        if (lines.removed.length === 0 && lines.added.length === 0) continue;
        const current = await readTextFile(join(target.contextDir, path));
        if (!current.ok) return err({ kind: "storage" });
        const markdown = reversed(current.value ?? "", lines);
        if (markdown === undefined) return err({ kind: "changed-since" });
        writes.push({ path, markdown });
      }
      if (writes.length === 0) return err({ kind: "not-undoable" });
      for (const { path, markdown } of writes) {
        const written = await writeTextFile(join(target.contextDir, path), markdown);
        if (!written.ok) return err({ kind: "storage" });
      }
      return ok(null);
    },
    () => ({ kind: "undo", title: `Undo: ${change.title}`, places: change.places }),
  );
};

/**
 * Undoes a change from Recent changes. A save is undone through its session, the same as its
 * note's Undo, so the note shows it and the model knows. A hand edit is reversed line by line.
 */
export const undoChange = async (
  target: ChangesTarget,
  id: ChangeId,
): Promise<Result<null, ChangeUndoRefusal>> => {
  const change = await target.contextFolder.changeOf(id);
  if (change === undefined) return err({ kind: "not-found" });
  if (change.kind === "hand-edit") return undoHandEdit(target, change);
  const made = await saveMadeBy(target.sessions, change);
  if (made === undefined || change.session === undefined) return err({ kind: "not-undoable" });
  const undone = await target.sessions.undoSave({ rawId: change.session, save: made.seq });
  return undone.ok ? undone : err({ kind: "session", error: undone.error });
};
