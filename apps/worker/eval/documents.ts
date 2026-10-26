import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocumentSave } from "@courtyard/contract";
import { documentPath } from "../src/features/documents/index.ts";
import type { ExpectedDocument } from "./scenarios.ts";
import { type Check, describeWords, hasWords } from "./words.ts";

// Documents (ADR 0020): the documents a turn saved or updated, judged on their text afterwards.

export const describeDocument = (save: DocumentSave) =>
  `${{ save: "saved", update: "updated", archive: "archived" }[save.action]} ${documentPath(save.document.slug)}${save.summary === undefined ? "" : ` (${save.summary})`}`;

/**
 * A turn's document checks (ADR 0020): one for each document it should save or update, judged on
 * the document's text afterwards, and one for saving no other. Nothing when the turn doesn't say.
 */
export const judgeDocuments = async (judge: {
  expected: readonly ExpectedDocument[] | undefined;
  saved: readonly DocumentSave[];
  /** The workspace's folder, where the documents are. */
  folder: string;
}): Promise<Check[]> => {
  const { expected, saved, folder } = judge;
  if (expected === undefined) return [];
  const left = [...saved];
  const checks: Check[] = [];
  for (const wanted of expected) {
    const index = left.findLastIndex((save) => save.action === wanted.action);
    const save = index === -1 ? undefined : left.splice(index, 1)[0];
    if (save === undefined) {
      checks.push({
        miss: `expected to ${wanted.action} a document; ${saved.length === 0 ? "saved none" : saved.map(describeDocument).join("; ")}`,
      });
      continue;
    }
    const path = documentPath(save.document.slug);
    const text = await readFile(join(folder, path), "utf8").catch(() => "");
    checks.push({
      miss: hasWords(text, { words: wanted.words })
        ? null
        : `expected ${path} to have ${describeWords(wanted.words)}; it reads "${text.replace(/\s+/g, " ").slice(0, 300)}"`,
    });
  }
  checks.push({
    miss: left.length === 0 ? null : `not expected: ${left.map(describeDocument).join("; ")}`,
  });
  return checks;
};
