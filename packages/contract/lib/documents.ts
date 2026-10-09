import { z } from "zod";
import { ChangeId } from "./session.ts";

// A workspace's documents (ADR 0020): longer writing kept as Markdown in its `docs` folder, named
// by its first `#` heading. Only the pages that show them load these.

/** The longest a document can be, in characters. */
export const DOCUMENT_MAX_CHARACTERS = 40_000;

/** The longest name the owner can give a document. */
export const DOCUMENT_NAME_MAX_LENGTH = 100;

/** A document's file name without `.md`: its name's letters and digits, words joined by dashes. */
export const DocumentSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80)
  .brand<"DocumentSlug">();
export type DocumentSlug = z.infer<typeof DocumentSlug>;

/** A document's name, as the owner gives it in the app: its first heading. */
export const DocumentName = z
  .string()
  .trim()
  .min(1, "Give the document a name.")
  .max(DOCUMENT_NAME_MAX_LENGTH, `Keep the name to ${DOCUMENT_NAME_MAX_LENGTH} characters.`)
  .refine((name) => !/[\r\n]/.test(name), "Keep the name to one line.");

/** A document as lists show it: its name, where it is in the workspace's folder, and its size. */
export const DocumentSummary = z.object({
  slug: DocumentSlug,
  name: z.string(),
  /** Its path in the workspace's folder: `docs/<slug>.md`. */
  path: z.string(),
  characters: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

/** A workspace's documents, the most recently changed first. */
export const DocumentList = z.object({ documents: z.array(DocumentSummary) });
export type DocumentList = z.infer<typeof DocumentList>;

/** One document for its page: what lists show, and its text below its heading. */
export const DocumentDetail = z.object({ document: DocumentSummary, body: z.string() });
export type DocumentDetail = z.infer<typeof DocumentDetail>;

/** Renaming a document: its heading and its file's name change together. */
export const DocumentRename = z.object({ name: DocumentName });
export type DocumentRename = z.infer<typeof DocumentRename>;

/** Save as document: the answer to the owner's message with this event number, named. */
export const SaveAsDocument = z.object({
  answer: z.number().int().positive(),
  name: DocumentName,
});
export type SaveAsDocument = z.infer<typeof SaveAsDocument>;

/** A change the owner made to a document, which Undo names: `null` when git couldn't keep it. */
export const DocumentChanged = z.object({ change: ChangeId.nullable() });
export type DocumentChanged = z.infer<typeof DocumentChanged>;
