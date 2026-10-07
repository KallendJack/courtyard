import type { ReactNode } from "react";
import { classes } from "@/lib/classes";
import { FormError } from "./form-error";

/**
 * What a note says: its label ("Saved to Facts"), its line, and the line it replaced. Grey when
 * the change is undone; struck through when the line is gone.
 */
export function NoteWords(props: {
  label: string;
  line?: string | undefined;
  was?: string | undefined;
  muted?: boolean;
  struck?: boolean;
}) {
  return (
    <p>
      <span
        className={classes(
          "font-semibold max-md:block md:mr-1.5",
          props.muted ? "text-muted-foreground" : "text-primary-text",
        )}
      >
        {props.label}
      </span>
      <span
        className={
          props.muted || props.struck ? "text-muted-foreground line-through" : "text-foreground"
        }
      >
        {props.line}
      </span>
      {props.was !== undefined && !props.muted && (
        <span className="text-muted-foreground"> (was {props.was})</span>
      )}
    </p>
  );
}

const isControl = (icon: ReactNode | { readonly control: ReactNode }) =>
  typeof icon === "object" && icon !== null && "control" in icon;

/**
 * One change to context as a quiet list item with a heather rule (ADR 0013): the note under an
 * answer, an entry in Recent changes, a change a tidy proposes. An icon (or a control, such as a
 * tick box), the words, an action slot that lines up from row to row (under the words on a phone),
 * and an error under them. A finished one is grey.
 */
export function NoteRow(props: {
  /** Beside the words: an icon, which screen readers skip, or a control, which they reach. */
  icon: ReactNode | { readonly control: ReactNode };
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
      {isControl(props.icon) ? (
        <span className={classes("mt-[3px] flex", !tall && "md:mt-0")}>{props.icon.control}</span>
      ) : (
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
      )}
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
