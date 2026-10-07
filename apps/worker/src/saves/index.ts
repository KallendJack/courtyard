import { join } from "node:path";
import {
  type ChangeId,
  CONTEXT_LINE_MAX_CHARACTERS,
  type ContextSection,
  LinePlace,
  OwnerSection,
  type PlacedLine,
  placeName,
  type Save,
  type SessionId,
  type WorkspaceId,
  type WorkspaceMode,
} from "@courtyard/contract";
import { z } from "zod";
import {
  addContextLine,
  hasContextLine,
  type LabelledLine,
  labelledLines,
  removeContextLine,
  replaceContextLine,
} from "../context-file/index.ts";
import type { ChangeKind, ContextFolder, Place } from "../context-folder/index.ts";
import { writeTextFile } from "../files.ts";
import { OWNER_FILE, readOwnerContext, STARTER_OWNER_CONTEXT } from "../owner-context/index.ts";
import { err, ok, type Result } from "../result.ts";
import { CONTEXT_FILE, getWorkspace, starterContextFile } from "../workspaces/index.ts";

/**
 * Saves to a workspace's context file and the owner context (ADR 0013): a model's, checked before
 * they're written, and the owner's Undo and Edit of one afterwards. Each is a change of its own in
 * the context folder.
 */

/**
 * What a model asks the save tool for, checked like anything else a model sends. Without a
 * place, a save goes where its line already is, or to How to answer me for `answers`, or else to
 * the workspace.
 */
const SaveRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    place: LinePlace.optional(),
    section: OwnerSection,
    text: z.string(),
  }),
  z.object({
    action: z.literal("change"),
    place: LinePlace.optional(),
    section: OwnerSection,
    label: z.string(),
    text: z.string(),
  }),
  z.object({ action: z.literal("remove"), label: z.string() }),
]);

/** Why the worker didn't make a save. The model is told, and may put it right once. */
export type SaveRefusal =
  /** Not a save the tool takes: a missing label or text, or `answers` in the workspace, say. */
  | { readonly kind: "malformed" }
  | { readonly kind: "unknown-label"; readonly label: string }
  /** The labelled line has changed since the model was shown it; `lines` are those it sees now. */
  | { readonly kind: "stale"; readonly lines: readonly LabelledLine[] }
  | { readonly kind: "duplicate"; readonly line: string }
  | { readonly kind: "not-one-line" }
  | { readonly kind: "too-long" }
  /** A code workspace's models save only to How to answer me (ADR 0010). */
  | { readonly kind: "code-workspace" }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" }
  /** The turn offered no save tool. */
  | { readonly kind: "not-offered" }
  | { readonly kind: "storage" };

/** Why the owner's Undo or Edit didn't happen. */
export type NoteRefusal =
  | { readonly kind: "changed-since" }
  | { readonly kind: "already-undone" }
  /** A removed line is back in the file already, so there's nothing to undo. */
  | { readonly kind: "already-back" }
  /** A removed line has nothing to edit. */
  | { readonly kind: "nothing-to-edit" }
  | { readonly kind: "storage"; readonly message: string };

/** A save as it stands now: what it did, its line after any edits, and whether it was undone. */
export type SaveState = {
  readonly save: Save;
  /** The saved line now, after the owner's edits; `undefined` for a removed line. */
  readonly current: PlacedLine | undefined;
  readonly undone: boolean;
};

/** Where saves go: the context folder, one workspace, and the session they belong to. */
export type SaveTarget = {
  readonly contextFolder: ContextFolder;
  readonly contextDir: string;
  readonly workspaceId: WorkspaceId;
  readonly sessionId: SessionId;
};

/** The two files a save can change, as written: the workspace's context file and the owner context. */
type Files = Record<PlacedLine["place"], string>;

/** Where a line goes: a section of the workspace's context file, or of the owner context. */
type Where =
  | { readonly place: "workspace"; readonly section: ContextSection }
  | { readonly place: "owner"; readonly section: OwnerSection };

/** The two files as they were shown to a model, `null` for one that wasn't there. */
export type ShownFiles = Record<PlacedLine["place"], string | null>;

/** Lines compared as a reader would: case, spacing and a closing full stop don't count. */
const sameLine = (a: string, b: string) => {
  const plain = (line: string) =>
    line
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.!\s]+$/, "")
      .trim();
  return plain(a) === plain(b);
};

/** A line as the model sent it: one line, trimmed, short enough to be one fact. */
const checkedLine = (text: string): Result<string, SaveRefusal> => {
  const line = text.trim();
  if (line === "" || /[\r\n]/.test(line)) return err({ kind: "not-one-line" });
  if (line.length > CONTEXT_LINE_MAX_CHARACTERS) return err({ kind: "too-long" });
  return ok(line);
};

/**
 * Makes one change to the workspace's context file and the owner context through the context
 * folder's queue: `change` gets both as they are now (from their starters when they aren't there)
 * and returns them changed, with a value, or a refusal. Only the files it changed are written, and
 * nothing is when it refuses. Says which change it committed, if git kept it.
 */
const changeFiles = async <T, E>(
  target: SaveTarget,
  options: {
    kind: Extract<ChangeKind, "save" | "undo" | "edit">;
    title: (value: T) => string;
    storage: E;
    change: (files: Files) => Result<{ files: Files; value: T }, E>;
  },
): Promise<Result<{ value: T; change: ChangeId | undefined }, E>> => {
  const changed = await target.contextFolder.changeWithId(
    async (): Promise<Result<{ value: T; places: Place[] }, E>> => {
      const [workspace, owner] = await Promise.all([
        getWorkspace(target.contextDir, target.workspaceId),
        readOwnerContext(target.contextDir),
      ]);
      if (!workspace.ok || !owner.ok) return err(options.storage);
      const { contextMarkdown, folder, summary } = workspace.value;
      const before: Files = {
        workspace: contextMarkdown ?? starterContextFile(summary.name),
        owner: owner.value?.markdown ?? STARTER_OWNER_CONTEXT,
      };
      const made = options.change(before);
      if (!made.ok) return made;
      const after = made.value.files;
      const files = [
        {
          path: join(target.contextDir, OWNER_FILE),
          before: before.owner,
          after: after.owner,
          place: { kind: "owner-context" } satisfies Place,
        },
        {
          path: join(folder, CONTEXT_FILE),
          before: before.workspace,
          after: after.workspace,
          place: { kind: "workspace", id: target.workspaceId } satisfies Place,
        },
      ].filter((file) => file.after !== file.before);
      const written: typeof files = [];
      for (const file of files) {
        if (!(await writeTextFile(file.path, file.after)).ok) {
          // A line moved between the files is never left in neither: put back what was written.
          for (const done of written) await writeTextFile(done.path, done.before);
          return err(options.storage);
        }
        written.push(file);
      }
      return ok({ value: made.value.value, places: files.map((file) => file.place) });
    },
    ({ value, places }) => ({
      kind: options.kind,
      title: options.title(value),
      places,
      session: target.sessionId,
    }),
  );
  if (!changed.ok) return changed;
  return ok({ value: changed.value.value.value, change: changed.value.id });
};

/** The files with a line moved or reworded, in either file, or `undefined` when it isn't there. */
const replaced = (files: Files, change: { was: PlacedLine; now: PlacedLine }) => {
  const { was, now } = change;
  if (was.place === now.place) {
    const markdown = replaceContextLine(files[was.place], change);
    return markdown === undefined ? undefined : { ...files, [was.place]: markdown };
  }
  const removed = removeContextLine(files[was.place], was);
  if (removed === undefined) return undefined;
  return { ...files, [was.place]: removed, [now.place]: addContextLine(files[now.place], now) };
};

/** Whether a turn in a workspace of this mode may save to where a line is (ADR 0010). */
const mayChange = (mode: WorkspaceMode, placed: Pick<PlacedLine, "place" | "section">) =>
  mode === "planning" || (placed.place === "owner" && placed.section === "answers");

/**
 * The lines a model in a workspace of this mode is shown, with their labels: the context file's,
 * and the owner context's that it reads (all of them, or How to answer me in a code workspace).
 */
const linesShown = (files: ShownFiles, mode: WorkspaceMode): LabelledLine[] => [
  ...(files.workspace === null ? [] : labelledLines(files.workspace, "workspace")),
  ...(files.owner === null ? [] : labelledLines(files.owner, "owner")).filter(
    (line) => mode === "planning" || (line.place === "owner" && line.section === "answers"),
  ),
];

/**
 * Where a save's line goes: the place it names; else How to answer me for `answers`; else
 * `fallback`. `undefined` for `answers` in the workspace, which has no such section.
 */
const whereTo = (
  request: { place?: PlacedLine["place"] | undefined; section: OwnerSection },
  fallback: PlacedLine["place"],
): Where | undefined => {
  const { section } = request;
  const place = request.place ?? (section === "answers" ? "owner" : fallback);
  if (place === "owner") return { place, section };
  return section === "answers" ? undefined : { place, section };
};

/** The save a request makes to the files, or why it can't. */
const applySave = (apply: {
  files: Files;
  request: z.infer<typeof SaveRequest>;
  /** The lines the model was shown, by label. */
  shown: ReadonlyMap<string, PlacedLine>;
  mode: WorkspaceMode;
}): Result<{ files: Files; value: Save }, SaveRefusal> => {
  const { files, request, shown, mode } = apply;
  // Only what the model can see counts as a repeat, so a refusal never quotes a line it isn't shown.
  const lines = linesShown(files, mode);
  const repeats = (line: string, except?: PlacedLine) =>
    lines.find(
      (other) =>
        sameLine(other.line, line) &&
        !(
          except &&
          other.place === except.place &&
          other.section === except.section &&
          other.line === except.line
        ),
    );
  /** The line a request saves, where it goes, or why it can't. */
  const savedLine = (save: {
    text: string;
    where: Where | undefined;
    /** The line a change replaces, which it may repeat. */
    replacing?: PlacedLine;
  }): Result<PlacedLine, SaveRefusal> => {
    const { where } = save;
    if (where === undefined) return err({ kind: "malformed" });
    if (!mayChange(mode, where)) return err({ kind: "code-workspace" });
    const line = checkedLine(save.text);
    if (!line.ok) return line;
    const repeated = repeats(line.value, save.replacing);
    if (repeated) return err({ kind: "duplicate", line: repeated.line });
    return ok({ ...where, line: line.value });
  };

  if (request.action === "add") {
    const saved = savedLine({ text: request.text, where: whereTo(request, "workspace") });
    if (!saved.ok) return saved;
    const markdown = addContextLine(files[saved.value.place], saved.value);
    return ok({
      files: { ...files, [saved.value.place]: markdown },
      value: { action: "add", saved: saved.value },
    });
  }

  // Changes and removals name a line by the label the model was shown.
  const was = shown.get(request.label.replace(/[[\]\s]/g, "").toUpperCase());
  if (was === undefined) return err({ kind: "unknown-label", label: request.label });
  if (!mayChange(mode, was)) return err({ kind: "code-workspace" });
  const stale: SaveRefusal = { kind: "stale", lines: linesShown(files, mode) };

  if (request.action === "remove") {
    const removed = removeContextLine(files[was.place], was);
    return removed === undefined
      ? err(stale)
      : ok({
          files: { ...files, [was.place]: removed },
          value: { action: "remove", replaced: was },
        });
  }

  if (!hasContextLine(files[was.place], was)) return err(stale);
  const saved = savedLine({
    text: request.text,
    where: whereTo(request, was.place),
    replacing: was,
  });
  if (!saved.ok) return saved;
  const changed = replaced(files, { was, now: saved.value });
  return changed === undefined
    ? err(stale)
    : ok({ files: changed, value: { action: "change", saved: saved.value, replaced: was } });
};

/** A save's change, as the context folder's history titles it. */
export const titleOf = (save: Save) => {
  switch (save.action) {
    case "add":
      return `Save to ${placeName(save.saved)}: ${save.saved.line}`;
    case "change":
      return `Change in ${placeName(save.saved)}: ${save.saved.line}`;
    case "remove":
      return `Remove from ${placeName(save.replaced)}: ${save.replaced.line}`;
  }
};

/** Each line a model may name, by the label it's shown it with. */
const labelsOf = (lines: readonly LabelledLine[]): ReadonlyMap<string, PlacedLine> =>
  new Map(lines.map(({ label, ...line }) => [label, line]));

/**
 * One turn's saves, as a function a provider hands each save to. Labels name lines as the model
 * was shown them when the turn started. When a labelled line has changed since, the save is
 * refused with the lines as they are now, and their labels count from then on. A code workspace's
 * turn saves only to How to answer me.
 */
export const createTurnSaves = (
  options: SaveTarget & {
    /** The files the model was shown. */
    shown: ShownFiles;
    mode: WorkspaceMode;
  },
) => {
  const { mode } = options;
  let shown = labelsOf(linesShown(options.shown, mode));
  return async (
    raw: unknown,
  ): Promise<Result<{ value: Save; change: ChangeId | undefined }, SaveRefusal>> => {
    const request = SaveRequest.safeParse(raw);
    if (!request.success) return err({ kind: "malformed" });
    const saved = await changeFiles<Save, SaveRefusal>(options, {
      kind: "save",
      title: titleOf,
      storage: { kind: "storage" },
      change: (files) => applySave({ files, request: request.data, shown, mode }),
    });
    if (!saved.ok && saved.error.kind === "stale") shown = labelsOf(saved.error.lines);
    return saved;
  };
};

const NOTE_STORAGE: NoteRefusal = {
  kind: "storage",
  message: "The context file or the owner context can't be read or written.",
};

/** The files with a save undone, or `undefined` when it can't be. */
const undoneFiles = (files: Files, state: SaveState): Files | undefined => {
  const { save, current } = state;
  if (save.action === "remove") {
    const { replaced: line } = save;
    return hasContextLine(files[line.place], line)
      ? undefined
      : { ...files, [line.place]: addContextLine(files[line.place], line) };
  }
  if (current === undefined) return undefined;
  if (save.action === "change") return replaced(files, { was: current, now: save.replaced });
  const removed = removeContextLine(files[current.place], current);
  return removed === undefined ? undefined : { ...files, [current.place]: removed };
};

/**
 * Undoes a save, as a change of its own: an added line comes out, a changed line goes back to
 * what it replaced, and a removed line goes back in. Refused when the line has changed since.
 */
export const undoSave = async (
  target: SaveTarget,
  state: SaveState,
): Promise<Result<null, NoteRefusal>> => {
  if (state.undone) return err({ kind: "already-undone" });
  const changed = await changeFiles<null, NoteRefusal>(target, {
    kind: "undo",
    title: () => `Undo: ${titleOf(state.save)}`,
    storage: NOTE_STORAGE,
    change: (files) => {
      const after = undoneFiles(files, state);
      if (after !== undefined) return ok({ files: after, value: null });
      return err({ kind: state.save.action === "remove" ? "already-back" : "changed-since" });
    },
  });
  return changed.ok ? ok(null) : changed;
};

/**
 * Edits a saved line's wording, section or place (the workspace or the owner context), as a
 * change of its own.
 */
export const editSave = async (
  target: SaveTarget,
  edit: { readonly state: SaveState; readonly now: PlacedLine },
): Promise<Result<null, NoteRefusal>> => {
  const { state, now } = edit;
  const { current } = state;
  if (state.undone) return err({ kind: "already-undone" });
  if (current === undefined) return err({ kind: "nothing-to-edit" });
  const changed = await changeFiles<null, NoteRefusal>(target, {
    kind: "edit",
    title: () => `Edit in ${placeName(now)}: ${now.line}`,
    storage: NOTE_STORAGE,
    change: (files) => {
      const edited = replaced(files, { was: current, now });
      return edited === undefined
        ? err({ kind: "changed-since" })
        : ok({ files: edited, value: null });
    },
  });
  return changed.ok ? ok(null) : changed;
};
