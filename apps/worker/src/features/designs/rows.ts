import type { DesignBoard, DesignDevice, DesignRow } from "@courtyard/contract";

/**
 * How a page's boards make rows (#522), as the house lays a Paper file out (`docs/agents/screens.md`):
 * each `Section · <area>` board starts a row, and the boards from its top down to the next
 * section's are its, Desktop, Tablet and Cover left to right. Boards above the first section, or
 * on a page with none (Drafts' grid by topic), make a row for each line of the grid.
 */

/** A board where it sits on the page, with its picture's name. */
export type PlacedBoard = Omit<DesignBoard, "label" | "device"> & {
  readonly x: number;
  readonly y: number;
};

const SECTION = /^Section\s*·\s*(.+)$/;
const DEVICE = /\b(desktop|tablet|cover)\b/i;
/** A screenshot's name on Live, `Built · Tablet · Home`, names its board after the word. */
const BUILT = /^Built\s*·\s*/;
const ON_DEVICE = /^(Desktop|Tablet|Cover)\s*·\s*(.+)$/;

/** Each device's place in a row, left to right. */
const ORDER: Record<DesignDevice, number> = { desktop: 0, tablet: 1, cover: 2, other: 3 };

const deviceOf = (name: string): DesignDevice => {
  const word = DEVICE.exec(name)?.[1]?.toLowerCase();
  return word === "desktop" || word === "tablet" || word === "cover" ? word : "other";
};

/** What a row calls a board: its device alone when the row is its screen's, else its name. */
const labelOf = (name: string, area: string) => {
  const shown = name.replace(BUILT, "");
  const onDevice = ON_DEVICE.exec(shown);
  return onDevice?.[2] === area && onDevice[1] !== undefined ? onDevice[1] : shown;
};

const boardOf = (placed: PlacedBoard, area: string): DesignBoard => {
  const { x: _x, y: _y, ...board } = placed;
  return { ...board, label: labelOf(board.name, area), device: deviceOf(board.name) };
};

const byPlace = (a: PlacedBoard, b: PlacedBoard) => a.y - b.y || a.x - b.x;

/** A grid line's name: the first part of a name its boards all share (`Audit`), else Boards. */
const sharedName = (boards: readonly PlacedBoard[]) => {
  const firsts = new Set(boards.map((board) => board.name.split(" · ")[0]?.trim() ?? ""));
  const [first] = firsts;
  return firsts.size === 1 &&
    first !== undefined &&
    first !== "" &&
    boards.some((b) => b.name.includes(" · "))
    ? first
    : "Boards";
};

/** Boards with no section, a row for each line of their grid: those whose heights overlap. */
const gridRows = (boards: readonly PlacedBoard[]): DesignRow[] => {
  const lines: PlacedBoard[][] = [];
  let bottom = Number.NEGATIVE_INFINITY;
  for (const board of [...boards].sort(byPlace)) {
    const line = lines.at(-1);
    if (line !== undefined && board.y < bottom) {
      line.push(board);
      bottom = Math.max(bottom, board.y + board.height);
    } else {
      lines.push([board]);
      bottom = board.y + board.height;
    }
  }
  return lines.map((line) => {
    const area = sharedName(line);
    return { area, boards: line.sort((a, b) => a.x - b.x).map((board) => boardOf(board, area)) };
  });
};

/** A page's rows, top to bottom. */
export const rowsOf = (boards: readonly PlacedBoard[]): DesignRow[] => {
  const sections = boards.filter((board) => SECTION.test(board.name)).sort(byPlace);
  const others = boards.filter((board) => !SECTION.test(board.name));
  const top = sections[0]?.y ?? Number.POSITIVE_INFINITY;
  const rows = gridRows(others.filter((board) => board.y < top));
  sections.forEach((section, index) => {
    const area = SECTION.exec(section.name)?.[1]?.trim() ?? section.name;
    const next = sections[index + 1]?.y ?? Number.POSITIVE_INFINITY;
    const its = others
      .filter((board) => board.y >= section.y && board.y < next)
      .sort((a, b) => ORDER[deviceOf(a.name)] - ORDER[deviceOf(b.name)] || byPlace(a, b));
    if (its.length > 0) rows.push({ area, boards: its.map((board) => boardOf(board, area)) });
  });
  return rows;
};
