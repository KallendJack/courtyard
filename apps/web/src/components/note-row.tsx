import type { ReactNode } from "react";
import { classes } from "@/lib/classes";
import { FormError } from "./form-error";

/**
 * One change to context as a quiet list item with a heather rule (ADR 0013): the note under an
 * answer, and an entry in Recent changes. An icon, the words, an action slot that lines up from
 * row to row (under the words on a phone), and an error under them. A finished one is grey.
 */
export function NoteRow(props: {
  icon: ReactNode;
  /** Grey: the change is undone. */
  muted?: boolean;
  /** Words over several lines, so the icon and actions sit at the top rather than the middle. */
  tall?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  error?: string | undefined;
}) {
  const { muted, tall } = props;
  return (
    <li
      className={classes(
        "grid grid-cols-[16px_1fr] items-start gap-x-3 border-l-2 py-0.5 pl-3 text-sm/[22px] md:grid-cols-[16px_1fr_auto]",
        !tall && "md:items-center",
        muted ? "border-border" : "border-primary",
      )}
    >
      <span
        aria-hidden
        className={classes(
          "mt-[3px] flex [&_svg]:size-4",
          !tall && "md:mt-0",
          muted ? "text-muted-foreground" : "text-primary-text",
        )}
      >
        {props.icon}
      </span>
      <div className="min-w-0 wrap-anywhere">{props.children}</div>
      {props.actions !== undefined && (
        <div className="col-start-2 -ml-3 flex md:col-start-3 md:ml-0 md:w-[84px]">
          {props.actions}
        </div>
      )}
      {props.error !== undefined && (
        <div className="col-start-2 md:col-end-4">
          <FormError message={props.error} />
        </div>
      )}
    </li>
  );
}
