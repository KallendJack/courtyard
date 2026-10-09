import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChangeId,
  DOCUMENT_MAX_CHARACTERS,
  type DocumentChange,
  type DocumentSave,
  DocumentSlug,
  type DocumentSummary,
  type SessionId,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import {
  type ChangeNote,
  type ContextFolder,
  sameFileText,
  undoWholeFiles,
  type WholeFile,
  type WholeFilesUndoRefusal,
} from "../context-folder/index.ts";
import { listFolder, readTextFile, removeFile, writeTextFileIn } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import {
  getWorkspace,
  plainName,
  RESERVED_ON_WINDOWS,
  type WorkspaceError,
} from "../workspaces/index.ts";

/**
 * A workspace's documents (ADR 0020): Markdown files in its `docs` folder, each named by its first
 * `#` heading and its file by that name. Every write is one change through the context folder, so
 * Recent changes lists it with Undo. Planning workspaces only.
 */

/** The folder in a workspace's folder that holds its documents. */
export const DOCS_FOLDER = "docs";

/** A document's path in its workspace's folder. */
export const documentPath = (slug: DocumentSlug) => `${DOCS_FOLDER}/${slug}.md`;

/** A document's path from the context folder's top, as its changes name it. */
const pathInFolder = (workspaceId: WorkspaceId, slug: DocumentSlug) =>
  `${workspaceId}/${documentPath(slug)}`;

/** The heading that names a document: `# Name`, outside any fenced code. */
const HEADING = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;

/** The line number of a document's first `#` heading, outside fenced code, if it has one. */
const headingLine = (lines: readonly string[]) => {
  let fenced = false;
  return lines.findIndex((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    return !fenced && HEADING.test(line);
  });
};

/** A document's name: its first `#` heading, or `undefined` when it has none. */
export const nameOf = (markdown: string) => {
  const lines = markdown.split(/\r?\n/);
  const at = headingLine(lines);
  return at === -1 ? undefined : HEADING.exec(lines[at] ?? "")?.[1]?.trim();
};

/** A document's text below its first heading, for its page, which shows the name as its title. */
export const bodyOf = (markdown: string) => {
  const lines = markdown.split(/\r?\n/);
  const at = headingLine(lines);
  return (at === -1 ? lines : lines.slice(at + 1)).join("\n").trim();
};

/** The longest a document's file name gets, cut at a word. */
const SLUG_MAX = 60;

/** The file name for a document called `name`, or `undefined` when it has no letter or digit. */
export const slugFor = (name: string): DocumentSlug | undefined => {
  let plain = plainName(name);
  if (plain.length > SLUG_MAX) plain = plain.slice(0, SLUG_MAX).replace(/-[^-]*$/, "");
  if (RESERVED_ON_WINDOWS.test(plain)) plain = `${plain}-document`;
  const slug = DocumentSlug.safeParse(plain);
  return slug.success ? slug.data : undefined;
};

/** Why a document wasn't saved, renamed or deleted. */
export type DocumentRefusal =
  /** The workspace can't be read, or isn't there. */
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** Only planning workspaces keep documents (ADR 0020). */
  | { readonly kind: "code-workspace" }
  /** It has no `#` heading to name it, or its name has no letter or digit. */
  | { readonly kind: "no-name" }
  | { readonly kind: "too-long"; readonly characters: number }
  /** Another document already has its file name. */
  | { readonly kind: "clash"; readonly name: string; readonly path: string }
  | { readonly kind: "not-found"; readonly path: string }
  /** The model hasn't read it in this answer, so it may not have seen it as it is now. */
  | { readonly kind: "unread"; readonly path: string }
  /** It has changed since the model read it. */
  | { readonly kind: "stale"; readonly path: string }
  | { readonly kind: "storage" };

/** Why a change to documents wasn't undone. */
export type DocumentUndoRefusal = WholeFilesUndoRefusal;

/**
 * Undoes a change to documents (saved, updated, renamed or deleted), as a change of its own: each
 * document goes back as it was, unless it's changed since.
 */
export const undoDocumentChange = (
  target: Pick<DocumentTarget, "contextDir" | "contextFolder" | "sessionId">,
  id: ChangeId,
) => undoWholeFiles(target, { id, kinds: ["document"] });

/** Where documents are kept: the context folder, and the session a change comes from, if any. */
export type DocumentTarget = {
  readonly contextDir: string;
  readonly contextFolder: ContextFolder;
  readonly workspaceId: WorkspaceId;
  readonly sessionId?: SessionId;
};

/** A planning workspace's folder, or why it can't keep documents. */
const documentsFolder = async (
  target: Pick<DocumentTarget, "contextDir" | "workspaceId">,
): Promise<Result<string, DocumentRefusal>> => {
  const workspace = await getWorkspace(target.contextDir, target.workspaceId);
  if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
  if (workspace.value.summary.mode !== "planning") return err({ kind: "code-workspace" });
  return ok(workspace.value.folder);
};

/** A document's file on the worker machine. */
const fileOf = (folder: string, slug: DocumentSlug) => join(folder, DOCS_FOLDER, `${slug}.md`);

/** A document's text, `undefined` when it isn't there. */
const readDocumentText = async (folder: string, slug: DocumentSlug) => {
  const read = await readTextFile(fileOf(folder, slug));
  return read.ok ? ok(read.value) : err<DocumentRefusal>({ kind: "storage" });
};

/** A document as lists show it, from its file. */
const summaryOf = async (
  folder: string,
  slug: DocumentSlug,
): Promise<Result<DocumentSummary | undefined, DocumentRefusal>> => {
  const text = await readDocumentText(folder, slug);
  if (!text.ok || text.value === undefined) return text.ok ? ok(undefined) : text;
  try {
    const { mtime } = await stat(fileOf(folder, slug));
    return ok({
      slug,
      name: nameOf(text.value) ?? slug,
      path: documentPath(slug),
      characters: text.value.length,
      updatedAt: mtime.toISOString(),
    });
  } catch {
    return err({ kind: "storage" });
  }
};

/** A planning workspace's documents, the most recently changed first. */
export const listDocuments = async (
  target: Pick<DocumentTarget, "contextDir" | "workspaceId">,
): Promise<Result<DocumentSummary[], DocumentRefusal>> => {
  const folder = await documentsFolder(target);
  if (!folder.ok) return folder;
  const names = await listFolder(join(folder.value, DOCS_FOLDER));
  if (!names.ok) return err({ kind: "storage" });
  const documents: DocumentSummary[] = [];
  for (const name of names.value) {
    const slug = DocumentSlug.safeParse(name.replace(/\.md$/, ""));
    if (!name.endsWith(".md") || !slug.success) continue;
    const summary = await summaryOf(folder.value, slug.data);
    if (!summary.ok) return summary;
    if (summary.value !== undefined) documents.push(summary.value);
  }
  return ok(documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
};

/** A document's name and file name, from its text, or why it can't be saved as it is. */
const namedText = (
  markdown: string,
): Result<{ name: string; slug: DocumentSlug }, DocumentRefusal> => {
  if (markdown.length > DOCUMENT_MAX_CHARACTERS) {
    return err({ kind: "too-long", characters: markdown.length });
  }
  const name = nameOf(markdown);
  const slug = name === undefined ? undefined : slugFor(name);
  return name === undefined || slug === undefined ? err({ kind: "no-name" }) : ok({ name, slug });
};

/** Writes a document's text, its folder made if it isn't there yet. */
const writeDocument = (folder: string, slug: DocumentSlug, markdown: string) =>
  writeTextFileIn(fileOf(folder, slug), markdown);

/** Text as a document keeps it: ending in one line break. */
const asFile = (markdown: string) => `${markdown.trimEnd()}\n`;

/** A saved document and the change it was committed as, if git kept it. */
export type DocumentSaved = { readonly save: DocumentSave; readonly change: ChangeId | undefined };

/** A change to documents, described for the context folder's history. */
const documentChange = (
  target: DocumentTarget,
  change: { title: string; paths: readonly string[] },
): ChangeNote => ({
  kind: "document",
  title: change.title,
  places: [{ kind: "workspace", id: target.workspaceId }],
  ...(target.sessionId === undefined ? {} : { session: target.sessionId }),
  files: [...new Set(change.paths)],
});

/**
 * Saves a new document, named by its first `#` heading, as one change. Refused when it has no
 * heading, is too long, or another document has its file name.
 */
export const saveNewDocument = async (
  target: DocumentTarget,
  markdown: string,
): Promise<Result<DocumentSaved, DocumentRefusal>> => {
  const named = namedText(markdown);
  if (!named.ok) return named;
  const { name, slug } = named.value;
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<DocumentSave, DocumentRefusal>> => {
      const folder = await documentsFolder(target);
      if (!folder.ok) return folder;
      const there = await readDocumentText(folder.value, slug);
      if (!there.ok) return there;
      if (there.value !== undefined) {
        return err({ kind: "clash", name: nameOf(there.value) ?? slug, path: documentPath(slug) });
      }
      if (!(await writeDocument(folder.value, slug, asFile(markdown)))) {
        return err({ kind: "storage" });
      }
      return ok({ action: "save", document: { slug, name } });
    },
    () =>
      documentChange(target, {
        title: `Save document: ${name}`,
        paths: [pathInFolder(target.workspaceId, slug)],
      }),
  );
  return saved.ok ? ok({ save: saved.value.value, change: saved.value.id }) : saved;
};

/**
 * Replaces a document with new text, as one change; its file's name follows its heading, so a new
 * name renames it. `check` is given its text now, and refuses the change by returning a refusal
 * (one the model hasn't seen as it is, say).
 */
const replaceDocument = async (
  target: DocumentTarget,
  replace: {
    slug: DocumentSlug;
    markdown: string;
    title: (was: { name: string }, now: { name: string }) => string;
    check?: (now: string) => DocumentRefusal | undefined;
  },
): Promise<Result<DocumentSaved, DocumentRefusal>> => {
  const named = namedText(replace.markdown);
  if (!named.ok) return named;
  const { name, slug } = named.value;
  let was: string = replace.slug;
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<DocumentSave, DocumentRefusal>> => {
      const folder = await documentsFolder(target);
      if (!folder.ok) return folder;
      const now = await readDocumentText(folder.value, replace.slug);
      if (!now.ok) return now;
      if (now.value === undefined)
        return err({ kind: "not-found", path: documentPath(replace.slug) });
      const refused = replace.check?.(now.value);
      if (refused !== undefined) return err(refused);
      was = nameOf(now.value) ?? replace.slug;
      if (slug !== replace.slug) {
        const there = await readDocumentText(folder.value, slug);
        if (!there.ok) return there;
        if (there.value !== undefined) {
          return err({
            kind: "clash",
            name: nameOf(there.value) ?? slug,
            path: documentPath(slug),
          });
        }
      }
      if (!(await writeDocument(folder.value, slug, asFile(replace.markdown)))) {
        return err({ kind: "storage" });
      }
      if (slug !== replace.slug && !(await removeFile(fileOf(folder.value, replace.slug)))) {
        return err({ kind: "storage" });
      }
      return ok({ action: "update", document: { slug, name } });
    },
    () =>
      documentChange(target, {
        title: replace.title({ name: was }, { name }),
        paths: [
          pathInFolder(target.workspaceId, replace.slug),
          pathInFolder(target.workspaceId, slug),
        ],
      }),
  );
  return saved.ok ? ok({ save: saved.value.value, change: saved.value.id }) : saved;
};

/** One document for its page: what lists show, and its text below its heading. */
export const getDocument = async (
  target: Pick<DocumentTarget, "contextDir" | "workspaceId">,
  slug: DocumentSlug,
): Promise<Result<{ document: DocumentSummary; body: string }, DocumentRefusal>> => {
  const folder = await documentsFolder(target);
  if (!folder.ok) return folder;
  const summary = await summaryOf(folder.value, slug);
  if (!summary.ok) return summary;
  if (summary.value === undefined) return err({ kind: "not-found", path: documentPath(slug) });
  const text = await readDocumentText(folder.value, slug);
  if (!text.ok) return text;
  return ok({ document: summary.value, body: bodyOf(text.value ?? "") });
};

/** A document's text with a new name: its first heading replaced, or one put above it. */
const renamed = (markdown: string, name: string) => {
  const lines = markdown.split(/\r?\n/);
  const at = headingLine(lines);
  if (at === -1) return `# ${name}\n\n${markdown}`;
  return [...lines.slice(0, at), `# ${name}`, ...lines.slice(at + 1)].join("\n");
};

/**
 * Renames a document, as one change: its heading and its file's name change together. Refused
 * when another document has the new file name.
 */
export const renameDocument = async (
  target: DocumentTarget,
  rename: { slug: DocumentSlug; name: string },
): Promise<Result<DocumentSaved, DocumentRefusal>> => {
  const folder = await documentsFolder(target);
  if (!folder.ok) return folder;
  const text = await readDocumentText(folder.value, rename.slug);
  if (!text.ok) return text;
  if (text.value === undefined) return err({ kind: "not-found", path: documentPath(rename.slug) });
  const was = text.value;
  return replaceDocument(target, {
    slug: rename.slug,
    markdown: renamed(was, rename.name),
    title: (before, now) => `Rename document: ${before.name} to ${now.name}`,
    // Renamed as it was read just now, so a model's update meanwhile isn't lost.
    check: (now) =>
      sameFileText(now, was) ? undefined : { kind: "stale", path: documentPath(rename.slug) },
  });
};

/** Deletes a document, as one change that Undo brings back. */
export const deleteDocument = async (
  target: DocumentTarget,
  slug: DocumentSlug,
): Promise<Result<ChangeId | undefined, DocumentRefusal>> => {
  let name: string = slug;
  const deleted = await target.contextFolder.changeWithId(
    async (): Promise<Result<null, DocumentRefusal>> => {
      const folder = await documentsFolder(target);
      if (!folder.ok) return folder;
      const text = await readDocumentText(folder.value, slug);
      if (!text.ok) return text;
      if (text.value === undefined) return err({ kind: "not-found", path: documentPath(slug) });
      name = nameOf(text.value) ?? slug;
      return (await removeFile(fileOf(folder.value, slug))) ? ok(null) : err({ kind: "storage" });
    },
    () =>
      documentChange(target, {
        title: `Delete document: ${name}`,
        paths: [pathInFolder(target.workspaceId, slug)],
      }),
  );
  return deleted.ok ? ok(deleted.value.id) : deleted;
};

/**
 * What a change did to a document, from the whole files it wrote or removed (see
 * `ChangeNote.files`), for Recent changes: and the path of the document it left, if any.
 */
export const documentChangeOf = (
  files: readonly WholeFile[],
): { document: DocumentChange; path: string | null } => {
  const made = files.find((file) => file.before === null && file.after !== null);
  const gone = files.find((file) => file.before !== null && file.after === null);
  const kept = files.find((file) => file.before !== null && file.after !== null);
  const slugAt = (path: string) => slugOfPath(path.split("/").slice(1).join("/")) ?? null;
  const named = (text: string | null, path: string) => nameOf(text ?? "") ?? slugAt(path) ?? path;
  if (made !== undefined && gone !== undefined) {
    const sameBody = bodyOf(made.after ?? "") === bodyOf(gone.before ?? "");
    return {
      document: {
        did: sameBody ? "renamed" : "updated",
        name: named(made.after, made.path),
        was: named(gone.before, gone.path),
        slug: slugAt(made.path),
      },
      path: made.path,
    };
  }
  if (made !== undefined) {
    return {
      document: { did: "saved", name: named(made.after, made.path), slug: slugAt(made.path) },
      path: made.path,
    };
  }
  if (kept !== undefined) {
    return {
      document: { did: "updated", name: named(kept.after, kept.path), slug: slugAt(kept.path) },
      path: kept.path,
    };
  }
  const path = gone?.path ?? files[0]?.path ?? "";
  return {
    document: { did: "deleted", name: named(gone?.before ?? null, path), slug: null },
    path: null,
  };
};

/** The document a path in the workspace's folder names (`docs/<slug>.md`), if it names one. */
export const slugOfPath = (path: string): DocumentSlug | undefined => {
  const [, name] = /^(?:\.\/)?docs\/([^/]+)\.md$/i.exec(path.trim().replace(/\\/g, "/")) ?? [];
  const slug = DocumentSlug.safeParse(name?.toLowerCase());
  return slug.success ? slug.data : undefined;
};

/** What a model sends the document tool, checked like anything else a model sends. */
const DocumentRequest = z.object({
  path: z.string().optional(),
  text: z.string(),
  change: z.string().optional(),
});

/** Why the document tool didn't save: the input doesn't fit, or the document was refused. */
export type DocumentToolRefusal =
  | DocumentRefusal
  | { readonly kind: "malformed" }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" };

/**
 * One turn's document tool (docs/ai-conduct.md, Documents): saves a new document, or replaces one
 * the model has read in this turn with its whole new text. It keeps each document's text as the
 * model last read or saved it, so an update is refused for a document it hasn't read in this
 * answer, or one changed since.
 */
export const createTurnDocuments = (target: DocumentTarget) => {
  /** Each document as the model last saw it in this turn, by its file's name. */
  const seen = new Map<DocumentSlug, string>();
  return {
    /** Notes a file the model read: a document's text as it is now is what it has seen. */
    read: async (path: string) => {
      const slug = slugOfPath(path);
      if (slug === undefined) return;
      const folder = await documentsFolder(target);
      const text = folder.ok ? await readDocumentText(folder.value, slug) : undefined;
      if (text?.ok && text.value !== undefined) seen.set(slug, text.value);
    },
    save: async (raw: unknown): Promise<Result<DocumentSaved, DocumentToolRefusal>> => {
      const request = DocumentRequest.safeParse(raw);
      if (!request.success) return err({ kind: "malformed" });
      const { path, text, change } = request.data;
      if (path === undefined || path.trim() === "") {
        const saved = await saveNewDocument(target, text);
        if (saved.ok) seen.set(saved.value.save.document.slug, asFile(text));
        return saved;
      }
      const slug = slugOfPath(path);
      if (slug === undefined) return err({ kind: "not-found", path: path.trim() });
      const shown = documentPath(slug);
      const summary = change?.replace(/\s+/g, " ").trim();
      const saved = await replaceDocument(target, {
        slug,
        markdown: text,
        title: (_, now) => `Update document: ${now.name}`,
        check: (now) => {
          const last = seen.get(slug);
          if (last === undefined) return { kind: "unread", path: shown };
          return sameFileText(now, last) ? undefined : { kind: "stale", path: shown };
        },
      });
      if (!saved.ok) return saved;
      seen.delete(slug);
      seen.set(saved.value.save.document.slug, asFile(text));
      return ok({
        ...saved.value,
        save: { ...saved.value.save, ...(summary ? { summary } : {}) },
      });
    },
  };
};

/**
 * An answer as a document called `name`: its first line, when that's a heading, gives way to the
 * name as the document's heading; otherwise the name goes above it.
 */
export const answerAsDocument = (answer: string, name: string) => {
  const lines = answer.trim().split(/\r?\n/);
  const rest = /^#{1,6}[ \t]/.test(lines[0] ?? "") ? lines.slice(1) : lines;
  return `# ${name}\n\n${rest.join("\n").trim()}\n`;
};
