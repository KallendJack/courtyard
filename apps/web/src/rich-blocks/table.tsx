import { ChevronsUpDown, MoveDown, MoveUp } from "lucide-react";
import { Children, type ComponentProps, createContext, use, useState } from "react";
import type { ExtraProps } from "react-markdown";
import { classes } from "@/lib/classes";
import "./stylesheet.ts";
import { childrenNamed, type MarkdownElement, textOf } from "./hast.ts";
import { nextSort, type Sort, sortedOrder } from "./sorting.ts";

/** What a table's headings and rows need from the table they're in. */
type Sorting = {
  readonly sort: Sort;
  readonly tap: (column: number) => void;
  /** Each heading's column, by its element. */
  readonly columns: ReadonlyMap<MarkdownElement, number>;
  /** The order to show the rows in, as indexes into the rows as written. */
  readonly order: readonly number[];
};

const SortingContext = createContext<Sorting | undefined>(undefined);

/** A table's headings by their column, and its rows' cells as text. */
const readTable = (table: MarkdownElement | undefined) => {
  const headings = childrenNamed(childrenNamed(childrenNamed(table, "thead")[0], "tr")[0], "th");
  const rows = childrenNamed(childrenNamed(table, "tbody")[0], "tr").map((row) =>
    childrenNamed(row, "td").map((cell) => textOf(cell)),
  );
  return { columns: new Map(headings.map((heading, column) => [heading, column])), rows };
};

/** A cell longer than this wraps, as a column of sentences; a shorter one keeps to one line. */
const ONE_LINE_CHARACTERS = 30;

/**
 * A Markdown table that sorts by any column (ADR 0021): a tap on a heading sorts up, then down,
 * then back to the order the model wrote, and the sort stays as more rows stream in. A wide table
 * scrolls sideways inside the answer, running to the screen's edge on a phone, so the page never
 * does. Drawn with `MarkdownHeading`, `MarkdownRows`, `MarkdownRow` and `MarkdownCell` for its
 * parts.
 */
export function MarkdownTable({ node, children }: ComponentProps<"table"> & ExtraProps) {
  const [sort, setSort] = useState<Sort>();
  const { columns, rows } = readTable(node);
  const sorting: Sorting = {
    sort,
    tap: (column) => setSort((now) => nextSort(now, column)),
    columns,
    order: sortedOrder(rows, sort),
  };
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="w-fit min-w-full overflow-clip rounded-md border bg-field">
        <table className="w-full border-collapse text-sm/[22px]">
          <SortingContext value={sorting}>{children}</SortingContext>
        </table>
      </div>
    </div>
  );
}

/** A column's heading: a button that sorts by it, its arrow saying which way it's sorted. */
export function MarkdownHeading({ node, children, style }: ComponentProps<"th"> & ExtraProps) {
  const sorting = use(SortingContext);
  const column = node === undefined ? undefined : sorting?.columns.get(node);
  const direction =
    column !== undefined && sorting?.sort?.column === column ? sorting.sort.direction : undefined;
  return (
    <th
      aria-sort={direction}
      style={style}
      className={classes(
        "border-b text-left font-semibold",
        direction === undefined ? "bg-background" : "bg-accent text-primary-text",
      )}
    >
      {sorting === undefined || column === undefined ? (
        <span className="block px-3.5 py-2.5">{children}</span>
      ) : (
        <button
          type="button"
          onClick={() => sorting.tap(column)}
          className="flex w-full cursor-pointer items-center gap-1 px-3.5 py-2.5 text-left font-semibold whitespace-nowrap -outline-offset-2"
        >
          {children}
          {direction === "ascending" ? (
            <MoveUp className="size-3" />
          ) : direction === "descending" ? (
            <MoveDown className="size-3" />
          ) : (
            <ChevronsUpDown className="size-3 text-placeholder" />
          )}
        </button>
      )}
    </th>
  );
}

/** A table's rows, in the order its sort puts them. */
export function MarkdownRows({ children }: ComponentProps<"tbody"> & ExtraProps) {
  const order = use(SortingContext)?.order;
  const rows = Children.toArray(children);
  return (
    <tbody>
      {order !== undefined && order.length === rows.length ? order.map((row) => rows[row]) : rows}
    </tbody>
  );
}

/** One row of a table, ruled off from the next. */
export function MarkdownRow({ children }: ComponentProps<"tr"> & ExtraProps) {
  return <tr className="border-b last:border-b-0">{children}</tr>;
}

/** One cell: the first in a row, naming it, a little bolder. */
export function MarkdownCell({ node, children, style }: ComponentProps<"td"> & ExtraProps) {
  return (
    <td
      style={style}
      className={classes(
        "px-3.5 py-2.5 align-top first:font-medium",
        textOf(node).length <= ONE_LINE_CHARACTERS ? "whitespace-nowrap" : "min-w-48",
      )}
    >
      {children}
    </td>
  );
}
