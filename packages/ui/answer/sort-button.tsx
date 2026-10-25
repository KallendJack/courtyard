import { ChevronsUpDown, MoveDown, MoveUp } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A column heading that sorts by its column with a tap (ADR 0021): its words, then an arrow for the
 * way it's sorted, or a faint up-and-down one when it isn't. It fills its heading cell.
 *
 * Only an answer's table uses it. In the web app its classes, like the table's, are in the rich
 * blocks' stylesheet, off the first load (styles.css leaves both files out, rich-blocks.css takes
 * them in): there it's styled only inside a `RichBlock`.
 */
export function SortButton(props: {
  sorted: "ascending" | "descending" | undefined;
  onSort: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onSort}
      className="flex w-full cursor-pointer items-center gap-1 px-3.5 py-2.5 text-left font-semibold whitespace-nowrap -outline-offset-2"
    >
      {props.children}
      {props.sorted === "ascending" ? (
        <MoveUp className="size-3" />
      ) : props.sorted === "descending" ? (
        <MoveDown className="size-3" />
      ) : (
        <ChevronsUpDown className="size-3 text-placeholder" />
      )}
    </button>
  );
}
