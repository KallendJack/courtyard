import { createHash } from "node:crypto";
import { join } from "node:path";
import { DESIGN_PAGES, DesignPage, type DesignPageKind, type Designs } from "@courtyard/contract";
import { z } from "zod";
import type { PaperBoard, PaperPage } from "../../integrations/paper/boards.ts";
import type { PaperFiles } from "../../integrations/paper/files.ts";
import {
  listFolder,
  readBytes,
  readJsonFile,
  removeFile,
  writeBytesIn,
  writeTextFileIn,
} from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import type { Background } from "../sessions/index.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";
import { type PlacedBoard, rowsOf } from "./rows.ts";

/**
 * A code workspace's Designs tab (#522): its Paper file's boards on Live, Agreed and Drafts, row by
 * row, exported through Paper's own MCP server and kept in the worker's data, so the last pictures
 * show with their age while Paper is closed. A visit asks Paper again once they're a few minutes
 * old, in the background; the tab keeps asking the shared way and shows them once they're in.
 */

/** Why a workspace's designs can't be shown. */
export type DesignsProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** It isn't a code workspace, or it has no Paper file. */
  | { readonly kind: "no-paper" }
  /** No such picture is kept. */
  | { readonly kind: "no-picture" };

/** How old the pictures may be before a visit asks Paper again. */
const FRESH_FOR_MS = 5 * 60 * 1000;

/** A picture's name: the start of its bytes' SHA-256, so a changed picture has a new one. */
const PICTURE_NAME = /^[0-9a-f]{32}$/;

/** What's kept for a workspace: its file's last export, its pictures' types, and the last try. */
const Kept = z.object({
  fileId: z.string(),
  pages: z.array(DesignPage),
  exportedAt: z.iso.datetime().nullable(),
  triedAt: z.iso.datetime(),
  reached: z.boolean(),
  pictures: z.record(z.string(), z.string()),
});
type Kept = z.infer<typeof Kept>;

/** Which of the picker's pages a page of the file is, by its name: `1 · Live`, `2 · Agreed`… */
const kindOf = (page: string): DesignPageKind | undefined =>
  /\blive\b/i.test(page)
    ? "live"
    : /\bagreed\b/i.test(page)
      ? "agreed"
      : /\bdrafts?\b/i.test(page)
        ? "drafts"
        : undefined;

const NO_PAGES: DesignPage[] = DESIGN_PAGES.map((kind) => ({ kind, count: 0, rows: [] }));

export const createDesigns = (options: {
  contextDir: string;
  dataDir: string;
  paperFiles: PaperFiles;
  now: () => number;
  background: Background;
}) => {
  const { contextDir, paperFiles, now } = options;
  /** The workspaces whose export is running now. */
  const running = new Set<string>();
  const folderOf = (id: string) => join(options.dataDir, "designs", id);
  const keptPath = (id: string) => join(folderOf(id), "designs.json");
  const picturePath = (id: string, name: string) => join(folderOf(id), "pictures", name);

  /** What's kept for a workspace's file, when it's that file's. */
  const keptFor = async (id: string, fileId: string) => {
    const kept = await readJsonFile(keptPath(id), Kept);
    return kept.ok && kept.value?.fileId === fileId ? kept.value : undefined;
  };

  /** Asks Paper for the file's boards, and keeps them, or that Paper couldn't be reached. */
  const exportNow = async (id: string, paper: { command: string; fileId: string }) => {
    const triedAt = new Date(now()).toISOString();
    const was = await keptFor(id, paper.fileId);
    const exported = await paperFiles.boards(paper.command, {
      fileId: paper.fileId,
      wanted: (page) => kindOf(page) !== undefined,
    });
    if (!exported.ok) {
      const kept: Kept =
        was === undefined
          ? {
              fileId: paper.fileId,
              pages: NO_PAGES,
              exportedAt: null,
              pictures: {},
              triedAt,
              reached: false,
            }
          : { ...was, triedAt, reached: false };
      await writeTextFileIn(keptPath(id), JSON.stringify(kept));
      return;
    }
    const pictures: Record<string, string> = {};
    const pages: DesignPage[] = [];
    for (const kind of DESIGN_PAGES) {
      const page: PaperPage | undefined = exported.value.find((each) => kindOf(each.name) === kind);
      const placed: PlacedBoard[] = [];
      for (const { picture, ...board } of page?.boards ?? ([] satisfies PaperBoard[])) {
        const name = createHash("sha256").update(picture.bytes).digest("hex").slice(0, 32);
        // A picture kept already, unchanged, isn't written again.
        if (pictures[name] === undefined && was?.pictures[name] === undefined) {
          await writeBytesIn(picturePath(id, name), picture.bytes);
        }
        pictures[name] = picture.mediaType;
        placed.push({ ...board, picture: name });
      }
      const rows = rowsOf(placed);
      pages.push({ kind, count: rows.reduce((all, row) => all + row.boards.length, 0), rows });
    }
    const kept: Kept = {
      fileId: paper.fileId,
      pages,
      exportedAt: triedAt,
      triedAt,
      reached: true,
      pictures,
    };
    await writeTextFileIn(keptPath(id), JSON.stringify(kept));
    // Pictures no board shows now are let go.
    const names = await listFolder(join(folderOf(id), "pictures"));
    for (const name of names.ok ? names.value : []) {
      if (PICTURE_NAME.test(name) && pictures[name] === undefined) {
        await removeFile(picturePath(id, name));
      }
    }
  };

  /** A code workspace's id and Paper file, or why it has no designs. */
  const paperOf = async (rawId: string) => {
    const workspace = await getWorkspace(contextDir, rawId);
    if (!workspace.ok) return err<DesignsProblem>({ kind: "workspace", error: workspace.error });
    const { summary, paper } = workspace.value;
    if (summary.mode !== "code" || paper === null) return err<DesignsProblem>({ kind: "no-paper" });
    return ok({ id: summary.id, paper });
  };

  return {
    /**
     * The workspace's designs as last kept, starting an export in the background when they're a
     * few minutes old (or there are none) and none is running.
     */
    get: async (rawId: string): Promise<Result<Designs, DesignsProblem>> => {
      const found = await paperOf(rawId);
      if (!found.ok) return found;
      const { id, paper } = found.value;
      const kept = await keptFor(id, paper.fileId);
      const tried = kept === undefined ? undefined : Date.parse(kept.triedAt);
      if (!running.has(id) && (tried === undefined || now() - tried >= FRESH_FOR_MS)) {
        running.add(id);
        options.background(exportNow(id, paper).finally(() => running.delete(id)));
      }
      return ok({
        fileId: paper.fileId,
        pages: kept?.pages ?? NO_PAGES,
        exportedAt: kept?.exportedAt ?? null,
        exporting: running.has(id),
        reached: kept?.reached ?? true,
      });
    },

    /** One of the workspace's kept pictures, by its name, with its type. */
    picture: async (
      rawId: string,
      name: string,
    ): Promise<Result<{ mediaType: string; bytes: Buffer }, DesignsProblem>> => {
      const found = await paperOf(rawId);
      if (!found.ok) return found;
      const { id, paper } = found.value;
      const mediaType = (await keptFor(id, paper.fileId))?.pictures[name];
      if (!PICTURE_NAME.test(name) || mediaType === undefined) return err({ kind: "no-picture" });
      const bytes = await readBytes(picturePath(id, name));
      return bytes.ok && bytes.value !== undefined
        ? ok({ mediaType, bytes: bytes.value })
        : err({ kind: "no-picture" });
    },
  };
};
