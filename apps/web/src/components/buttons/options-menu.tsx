import { IconButton } from "@courtyard/ui/buttons/button.tsx";
import { Ellipsis } from "lucide-react";
import { type ReactNode, useState } from "react";
import { placeUnder, useAnchorName } from "../layout/place-under.ts";
import { useDialog } from "../layout/use-dialog.ts";

/** One of a ⋯ menu's choices: its icon, its name, and a few words under it when there's more to say. */
export type MenuChoice = {
  readonly icon?: ReactNode;
  readonly name: string;
  readonly note?: string;
  readonly onPick: () => void;
};

/**
 * One quiet ⋯ that opens a small sheet under it, its right edge level with the ⋯'s (#333; Paper,
 * "Tablet · Workspace ⋯: rename, icon, archive"): what's tapped less often, one tap away, such as a
 * workspace's Rename and Archive, or Start again on a turn a restart cut off (#186). The sheet
 * closes as a choice is picked, then does it.
 */
export function OptionsMenu(props: {
  /** The ⋯'s name, for screen readers and on hover: "Workspace options". */
  label: string;
  /** The sheet's name, for screen readers. */
  menuLabel: string;
  choices: readonly MenuChoice[];
  /** Rounded square rather than round, to match the rows beside it. */
  square?: boolean;
  /** How wide the sheet is where there's room. */
  width?: number;
  /**
   * The ⋯'s anchor name (`useAnchorName`), when a sheet one of its choices opens goes under the ⋯
   * too (Allowed commands, #185). Its own otherwise.
   */
  anchor?: string;
}) {
  const [open, setOpen] = useState(false);
  const own = useAnchorName();
  const anchor = props.anchor ?? own;
  const dialog = useDialog(open, () => setOpen(false));
  return (
    <>
      <IconButton
        label={props.label}
        icon={<Ellipsis />}
        square={props.square === true}
        look={open ? "open" : "quiet"}
        expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        style={{ anchorName: anchor }}
      />
      <dialog
        {...dialog}
        aria-label={props.menuLabel}
        style={placeUnder(anchor, { side: "right", gap: 8, width: props.width ?? 300 })}
        className="fixed m-0 rounded-tile border border-input bg-popover text-popover-foreground shadow-raised backdrop:bg-card/60"
      >
        {open && (
          <div className="flex flex-col gap-1.5 p-2.5">
            {props.choices.map((choice) => (
              <button
                key={choice.name}
                type="button"
                onClick={() => {
                  setOpen(false);
                  choice.onPick();
                }}
                className="flex min-h-12 items-center gap-3 rounded-row bg-secondary px-3 py-2 text-left text-foreground/85 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:size-4.5 [&>svg]:shrink-0"
              >
                {choice.icon}
                <span className="flex flex-col gap-px">
                  <span className="text-interface font-semibold text-foreground">
                    {choice.name}
                  </span>
                  {choice.note !== undefined && (
                    <span className="text-meta font-medium text-muted-foreground">
                      {choice.note}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </dialog>
    </>
  );
}
