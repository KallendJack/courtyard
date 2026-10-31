import type { PaperFile } from "@courtyard/contract";
import { err, ok } from "../../lib/result.ts";
import { exportBoards, type PaperBoard } from "./boards.ts";
import type { AskPaper } from "./client.ts";
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

/** An answer as Paper's MCP server gives one: a header part, then its JSON. */
const answer = (body: unknown) =>
  ok({ texts: [JSON.stringify({ file: { id: "fake" } }), JSON.stringify(body)], pictures: [] });

/**
 * Paper's own tools over a file's pages, answering as its MCP server does, so a board export runs
 * the real `exportBoards`: `get_basic_info` lists `listsAtMost` boards and says it left the rest
 * out, which `get_tree_summary` and `get_node_info` then find.
 */
const askOf =
  (pages: readonly FakePage[], listsAtMost: number): AskPaper =>
  async (tool, args) => {
    const pageOf = (id: unknown) => pages.find((_, index) => `page-${index}` === id);
    const boardOf = (id: unknown) =>
      pages.flatMap((page) => page.boards).find((board) => board.id === id);
    const described = (board: FakeBoard) => ({
      id: board.id,
      name: board.name,
      width: board.width,
      height: board.height,
      worldX: board.x,
      worldY: board.y,
    });
    const listed = pages.map((page, index) => ({
      type: "page",
      id: `page-${index}`,
      name: page.name,
    }));
    switch (tool) {
      case "get_basic_info": {
        const page = pageOf(args.pageId);
        if (page === undefined) return answer({ pages: listed });
        return answer({
          pages: listed,
          rootNodeId: `root-${String(args.pageId)}`,
          artboards: page.boards.slice(0, listsAtMost).map(described),
          ...(page.boards.length > listsAtMost ? { truncated: true } : {}),
        });
      }
      case "get_tree_summary": {
        const page = pageOf(String(args.nodeId).replace(/^root-/, ""));
        const lines = (page?.boards ?? []).map(
          (board) => `  Frame "${board.name}" (${board.id}) ${board.width}×${board.height}`,
        );
        return answer({ summary: [` "" (${String(args.nodeId)}) ?×?`, ...lines].join("\n") });
      }
      case "get_node_info": {
        const board = boardOf(args.nodeId);
        return board === undefined ? err(PAPER_NOT_OPEN) : answer(described(board));
      }
      case "get_screenshot": {
        const board = boardOf(args.nodeId);
        if (board === undefined) return err(PAPER_NOT_OPEN);
        return ok({ texts: [], pictures: [pictureOf(board)] });
      }
      default:
        return err(PAPER_NOT_OPEN);
    }
  };

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
    /** How many boards `get_basic_info` lists at most, as Paper's 100. */
    listsAtMost?: number;
  } = {},
) => {
  const listsAtMost = options.listsAtMost ?? 100;
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
      return exportBoards(askOf(options.boards?.[file.fileId] ?? [], listsAtMost), file);
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
