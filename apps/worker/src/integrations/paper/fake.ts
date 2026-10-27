import type { PaperFile } from "@courtyard/contract";
import { err, ok } from "../../lib/result.ts";
import type { PaperBoard } from "./boards.ts";
import { PAPER_NOT_OPEN, type PaperFiles } from "./files.ts";

/** A board in the fake's files: its picture is drawn for it, a plate naming it. */
export type FakeBoard = Omit<PaperBoard, "picture">;

/** A page in the fake's files, by its name, with its boards. */
export type FakePage = { readonly name: string; readonly boards: readonly FakeBoard[] };

const escaped = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A board's picture: a dark plate its size, with its name on it, as an SVG. */
const pictureOf = (board: FakeBoard) => ({
  mediaType: "image/svg+xml",
  bytes: new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${board.width}" height="${board.height}" viewBox="0 0 ${board.width} ${board.height}"><rect width="100%" height="100%" fill="#111"/><text x="40" y="80" fill="#ddd" font-family="sans-serif" font-size="40">${escaped(board.name)}</text></svg>`,
  ),
});

/**
 * For tests only: the owner's Paper files in memory (#308), so connecting Paper from a code
 * workspace's page is tested without Paper, and each file's pages of boards (#522), so its
 * Designs tab is. `close` makes it act as Paper does when it isn't open on the worker machine.
 */
export const createFakePaperFiles = (
  options: {
    files?: readonly PaperFile[];
    /** Each file's pages, by the file's id. */
    boards?: Readonly<Record<string, readonly FakePage[]>>;
  } = {},
) => {
  const files: PaperFile[] = [...(options.files ?? [])];
  let open = true;
  /** The command each ask was made with, in order, as a test checks which Paper was asked. */
  const asked: string[] = [];
  let made = 0;

  const paper: PaperFiles = {
    list: async (command) => {
      asked.push(command);
      return open ? ok([...files]) : err(PAPER_NOT_OPEN);
    },
    create: async (command, name) => {
      asked.push(command);
      if (!open) return err(PAPER_NOT_OPEN);
      made += 1;
      const file = { id: `new-file-${made}`, name };
      files.unshift(file);
      return ok(file);
    },
    boards: async (command, file) => {
      asked.push(command);
      if (!open) return err(PAPER_NOT_OPEN);
      return ok(
        (options.boards?.[file.fileId] ?? [])
          .filter((page) => file.wanted(page.name))
          .map((page) => ({
            name: page.name,
            boards: page.boards.map((board) => ({ ...board, picture: pictureOf(board) })),
          })),
      );
    },
  };
  return {
    paper,
    /** Paper is closed on the worker machine now, or open again. */
    setOpen: (now: boolean) => {
      open = now;
    },
    /** The files Paper has now, newest first. */
    files: () => [...files],
    asked: () => [...asked],
  };
};

export type FakePaperFiles = ReturnType<typeof createFakePaperFiles>;
