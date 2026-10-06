import { join } from "node:path";
import {
  CONTEXT_LINE_MAX_CHARACTERS,
  ContextSection,
  type PlacedLine,
  type Save,
  type SessionId,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import {
  addContextLine,
  hasContextLine,
  labelledLines,
  removeContextLine,
  replaceContextLine,
} from "../context-file/index.ts";
import type { ChangeKind, ContextFolder } from "../context-folder/index.ts";
import { writeTextFile } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import { CONTEXT_FILE, getWorkspace, starterContextFile } from "../workspaces/index.ts";

/**
 * Saves to a workspace's context file (ADR 0013): a model's, checked before they're written, and
 * the owner's Undo and Edit of one afterwards. Each is a change of its own in the context folder.
 */

/** What a model asks the save tool for, checked like anything else a model sends. */
const SaveRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), section: ContextSection, text: z.string() }),
  z.object({
    action: z.literal("change"),
    section: ContextSection,
    label: z.string(),
    text: z.string(),
  }),
  z.object({ action: z.literal("remove"), label: z.string() }),
]);
type SaveRequest = z.infer<typeof SaveRequest>;

/** Why the worker didn't make a save. The model is told, and may put it right once. */
export type SaveRefusal =
  /** Not a save the tool takes: a missing label or text, say. */
  | { readonly kind: "malformed" }
  | { readonly kind: "unknown-label"; readonly label: string }
  /** The labelled line has changed since the model was shown it; `markdown` is the file now. */
  | { readonly kind: "stale"; readonly markdown: string }
  | { readonly kind: "duplicate"; readonly line: string }
  | { readonly kind: "not-one-line" }
  | { readonly kind: "too-long" }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" }
  /** The turn offered no save tool (a code workspace, say). */
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
 * Makes one change to the workspace's context file through the context folder's queue: `change`
 * gets the file as it is now (the starter when there isn't one) and returns the new file and a
 * value, or a refusal. Nothing is written when it refuses.
 */
const changeContextFile = <T, E>(
  target: SaveTarget,
  options: {
    kind: ChangeKind;
    title: (value: T) => string;
    storage: E;
    change: (markdown: string) => Result<{ markdown: string; value: T }, E>;
  },
): Promise<Result<T, E>> =>
  target.contextFolder.change(
    async (): Promise<Result<T, E>> => {
      const workspace = await getWorkspace(target.contextDir, target.workspaceId);
      if (!workspace.ok) return err(options.storage);
      const { contextMarkdown, folder, summary } = workspace.value;
      const changed = options.change(contextMarkdown ?? starterContextFile(summary.name));
      if (!changed.ok) return changed;
      const written = await writeTextFile(join(folder, CONTEXT_FILE), changed.value.markdown);
      return written.ok ? ok(changed.value.value) : err(options.storage);
    },
    (value) => ({
      kind: options.kind,
      title: options.title(value),
      places: [{ kind: "workspace", id: target.workspaceId }],
      session: target.sessionId,
    }),
  );

/** The save a request makes to a file, or why it can't. */
const applySave = (apply: {
  markdown: string;
  request: SaveRequest;
  /** The lines the model was shown, by label. */
  shown: ReadonlyMap<string, PlacedLine>;
}): Result<{ markdown: string; value: Save }, SaveRefusal> => {
  const { markdown, request, shown } = apply;
  const lines = labelledLines(markdown);
  const repeats = (line: string, except?: PlacedLine) =>
    lines.find(
      (other) =>
        sameLine(other.line, line) &&
        !(except && other.section === except.section && other.line === except.line),
    );

  if (request.action === "add") {
    const line = checkedLine(request.text);
    if (!line.ok) return line;
    const repeated = repeats(line.value);
    if (repeated) return err({ kind: "duplicate", line: repeated.line });
    const saved = { section: request.section, line: line.value };
    return ok({ markdown: addContextLine(markdown, saved), value: { action: "add", saved } });
  }

  // Changes and removals name a line by the label the model was shown.
  const replaced = shown.get(request.label.replace(/[[\]\s]/g, "").toUpperCase());
  if (replaced === undefined) return err({ kind: "unknown-label", label: request.label });
  const stale: SaveRefusal = { kind: "stale", markdown };

  if (request.action === "remove") {
    const removed = removeContextLine(markdown, replaced);
    return removed === undefined
      ? err(stale)
      : ok({ markdown: removed, value: { action: "remove", replaced } });
  }

  if (!hasContextLine(markdown, replaced)) return err(stale);
  const line = checkedLine(request.text);
  if (!line.ok) return line;
  const repeated = repeats(line.value, replaced);
  if (repeated) return err({ kind: "duplicate", line: repeated.line });
  const saved = { section: request.section, line: line.value };
  const changed = replaceContextLine(markdown, { was: replaced, now: saved });
  return changed === undefined
    ? err(stale)
    : ok({ markdown: changed, value: { action: "change", saved, replaced } });
};

/** A save's change, as the context folder's history titles it. */
const titleOf = (save: Save) => {
  switch (save.action) {
    case "add":
      return `Save to ${save.saved.section}: ${save.saved.line}`;
    case "change":
      return `Change in ${save.saved.section}: ${save.saved.line}`;
    case "remove":
      return `Remove from ${save.replaced.section}: ${save.replaced.line}`;
  }
};

/** Each line's place, by the label a model is shown it with. */
const labelsOf = (markdown: string | null): ReadonlyMap<string, PlacedLine> =>
  new Map(
    (markdown === null ? [] : labelledLines(markdown)).map(({ label, section, line }) => [
      label,
      { section, line },
    ]),
  );

/**
 * One turn's saves, as a function a provider hands each save to. Labels name lines as the model
 * was shown them when the turn started. When a labelled line has changed since, the save is
 * refused with the file as it is now, and its labels count from then on.
 */
export const createTurnSaves = (
  options: SaveTarget & {
    /** The context file the model was shown, or `null` when there wasn't one. */
    shown: string | null;
  },
) => {
  let shown = labelsOf(options.shown);
  return async (raw: unknown): Promise<Result<Save, SaveRefusal>> => {
    const request = SaveRequest.safeParse(raw);
    if (!request.success) return err({ kind: "malformed" });
    const saved = await changeContextFile<Save, SaveRefusal>(options, {
      kind: "save",
      title: titleOf,
      storage: { kind: "storage" },
      change: (markdown) => applySave({ markdown, request: request.data, shown }),
    });
    if (!saved.ok && saved.error.kind === "stale") shown = labelsOf(saved.error.markdown);
    return saved;
  };
};

const NOTE_STORAGE: NoteRefusal = {
  kind: "storage",
  message: "The workspace's context file can't be read or written.",
};

/** The file with a save undone, or `undefined` when it can't be. */
const undoneMarkdown = (markdown: string, state: SaveState) => {
  const { save, current } = state;
  if (save.action === "remove") {
    return hasContextLine(markdown, save.replaced)
      ? undefined
      : addContextLine(markdown, save.replaced);
  }
  if (current === undefined) return undefined;
  return save.action === "add"
    ? removeContextLine(markdown, current)
    : replaceContextLine(markdown, { was: current, now: save.replaced });
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
  return changeContextFile<null, NoteRefusal>(target, {
    kind: "undo",
    title: () => `Undo: ${titleOf(state.save)}`,
    storage: NOTE_STORAGE,
    change: (markdown) => {
      const after = undoneMarkdown(markdown, state);
      if (after !== undefined) return ok({ markdown: after, value: null });
      return err({ kind: state.save.action === "remove" ? "already-back" : "changed-since" });
    },
  });
};

/** Edits a saved line's wording or section, in place, as a change of its own. */
export const editSave = async (
  target: SaveTarget,
  edit: { readonly state: SaveState; readonly now: PlacedLine },
): Promise<Result<null, NoteRefusal>> => {
  const { state, now } = edit;
  const { current } = state;
  if (state.undone) return err({ kind: "already-undone" });
  if (current === undefined) return err({ kind: "nothing-to-edit" });
  return changeContextFile<null, NoteRefusal>(target, {
    kind: "edit",
    title: () => `Edit in ${now.section}: ${now.line}`,
    storage: NOTE_STORAGE,
    change: (markdown) => {
      const edited = replaceContextLine(markdown, { was: current, now });
      return edited === undefined
        ? err({ kind: "changed-since" })
        : ok({ markdown: edited, value: null });
    },
  });
};
