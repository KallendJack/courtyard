import type { WorkspaceIcon as Icon } from "@courtyard/contract";
import { Archive, Ellipsis, Pencil } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { IconButton } from "./button.tsx";
import { useDialog } from "./use-dialog.ts";
import { WorkspaceIcon } from "./workspace-icon.tsx";

// Loaded when the owner first picks Change icon.
const IconSheet = lazy(() => import("./icon-sheet.tsx"));

/** The gap the menu keeps from the screen's edges, as the page's own gutter. */
const GUTTER = 16;
/** The menu's width where there's room (Paper, "Tablet · Workspace ⋯: rename, icon, archive"). */
const WIDTH = 300;

/** Where the menu opens: under the ⋯, its right edge level with the ⋯'s, never off the screen. */
const placeUnder = (anchor: HTMLElement | null) => {
  const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER);
  const box = anchor?.getBoundingClientRect();
  const right = box?.right ?? window.innerWidth - GUTTER;
  return { top: (box?.bottom ?? 5 * GUTTER) + 8, left: Math.max(GUTTER, right - width), width };
};

/**
 * One quiet ⋯ beside a workspace's name (#333; Paper, "Tablet · Workspace ⋯: rename, icon,
 * archive"), opening a small sheet under it: Rename, Change icon (the Icon sheet) and Archive, so
 * the title area keeps only the name while nothing the page could do goes away. `choose` returns
 * an error to show, or nothing once the icon is kept.
 */
export function WorkspaceMenu(props: {
  workspaceName: string;
  icon: Icon;
  choose: (icon: Icon) => Promise<string | undefined>;
  onRename: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Whether the Icon sheet is open, or has never been, so it isn't loaded until it's wanted. */
  const [picking, setPicking] = useState<boolean>();
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useDialog(open, () => setOpen(false));
  const [place, setPlace] = useState(() => ({ top: 0, left: 0, width: 0 }));
  useEffect(() => {
    if (open) setPlace(placeUnder(button.current));
  }, [open]);

  /** Closes the menu, then does what was picked. */
  const then = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <>
      <IconButton
        ref={button}
        label="Workspace options"
        icon={<Ellipsis />}
        square
        look={open ? "open" : "quiet"}
        expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <dialog
        {...dialog}
        aria-label={props.workspaceName}
        style={place}
        className="fixed m-0 rounded-tile border border-input bg-popover text-popover-foreground shadow-raised backdrop:bg-card/60"
      >
        {open && (
          <div className="flex flex-col gap-1.5 p-2.5">
            <MenuRow icon={<Pencil />} onClick={then(props.onRename)}>
              Rename
            </MenuRow>
            <MenuRow
              icon={<WorkspaceIcon icon={props.icon} size="md" />}
              onClick={then(() => setPicking(true))}
            >
              Change icon
            </MenuRow>
            <MenuRow
              icon={<Archive />}
              note="Hidden, never deleted"
              onClick={then(props.onArchive)}
            >
              Archive
            </MenuRow>
          </div>
        )}
      </dialog>
      {picking !== undefined && (
        <Suspense>
          <IconSheet
            workspaceName={props.workspaceName}
            icon={props.icon}
            open={picking}
            onClose={() => setPicking(false)}
            choose={props.choose}
          />
        </Suspense>
      )}
    </>
  );
}

/** One of the menu's rows: its icon, its name, and a few words under it when there's more to say. */
function MenuRow(props: {
  icon: ReactNode;
  note?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex min-h-12 items-center gap-3 rounded-row bg-secondary px-3 py-2 text-left text-foreground/85 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:size-4.5 [&>svg]:shrink-0"
    >
      {props.icon}
      <span className="flex flex-col gap-px">
        <span className="text-interface font-semibold text-foreground">{props.children}</span>
        {props.note !== undefined && (
          <span className="text-label font-medium text-muted-foreground">{props.note}</span>
        )}
      </span>
    </button>
  );
}
