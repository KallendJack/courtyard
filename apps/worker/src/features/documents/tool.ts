import type { DocumentSlug } from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";
import { sameFileText } from "../context-folder/index.ts";
import { type PlanningFilesTarget, planningFolder } from "../planning-files/index.ts";
import {
  archiveDocument,
  asFile,
  type DocumentRefusal,
  type DocumentSaved,
  documentPath,
  readDocumentText,
  replaceDocument,
  saveNewDocument,
  slugOfPath,
} from "./index.ts";

/** What a model sends the document tool, checked like anything else a model sends. */
const DocumentRequest = z.union([
  z.object({ path: z.string(), archive: z.literal(true) }),
  z.object({
    path: z.string().optional(),
    text: z.string(),
    change: z.string().optional(),
    archive: z.literal(false).optional(),
  }),
]);

/** Why the document tool didn't save: the input doesn't fit, or the document was refused. */
export type DocumentToolRefusal =
  | DocumentRefusal
  | { readonly kind: "malformed" }
  /** The owner stopped the turn, so nothing more is saved. */
  | { readonly kind: "stopped" };

/**
 * One turn's document tool (docs/ai-conduct.md, Documents): saves a new document, replaces one
 * the model has read in this turn with its whole new text, or archives one (#786). It keeps each
 * document's text as the model last read or saved it, so an update is refused for a document it
 * hasn't read in this answer, or one changed since.
 */
export const createTurnDocuments = (target: PlanningFilesTarget) => {
  /** Each document as the model last saw it in this turn, by its file's name. */
  const seen = new Map<DocumentSlug, string>();
  return {
    /** Notes a file the model read: a document's text as it is now is what it has seen. */
    read: async (path: string) => {
      const slug = slugOfPath(path);
      if (slug === undefined) return;
      const folder = await planningFolder(target);
      const text = folder.ok ? await readDocumentText(folder.value, slug) : undefined;
      if (text?.ok && text.value !== undefined) seen.set(slug, text.value);
    },
    save: async (raw: unknown): Promise<Result<DocumentSaved, DocumentToolRefusal>> => {
      const request = DocumentRequest.safeParse(raw);
      if (!request.success) return err({ kind: "malformed" });
      if (request.data.archive === true) {
        const { path } = request.data;
        const slug = slugOfPath(path);
        if (slug === undefined) return err({ kind: "not-found", path: path.trim() });
        const archived = await archiveDocument(target, slug);
        if (archived.ok) seen.delete(slug);
        return archived;
      }
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
