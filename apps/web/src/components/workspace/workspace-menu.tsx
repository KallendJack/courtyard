import type { WorkspaceIcon as Icon, WorkspaceId, WorkspaceMode } from "@courtyard/contract";
import { Archive, Bell, BookOpen, Pencil, SquareTerminal } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { OptionsMenu } from "../buttons/options-menu.tsx";
import { useAnchorName } from "../layout/place-under.ts";
import { WorkspaceIcon } from "./workspace-icon.tsx";

// Loaded when the owner first picks Change icon, Allowed commands or Notify me.
const IconSheet = lazy(() => import("../sheets/icon-sheet.tsx"));
const AllowedCommandsSheet = lazy(() => import("../sheets/allowed-commands-sheet.tsx"));
const NotifyMeSheet = lazy(() => import("../sheets/notify-me-sheet.tsx"));

/**
 * One quiet ⋯ beside a workspace's name (#333; Paper, "Tablet · Workspace ⋯: rename, icon,
 * archive"), opening a small sheet under it: a planning workspace's What Courtyard knows (#481),
 * Rename, Change icon (the Icon sheet), a code workspace's Allowed commands (what the owner
 * allowed always, #185; a planning workspace runs no commands, #600), Notify me (what its
 * notifications tell of, #493), and Archive, so the title area keeps only the name while nothing the page could do goes away. `choose` returns an error to show, or
 * nothing once the icon is kept.
 */
export function WorkspaceMenu(props: {
  workspaceId: WorkspaceId;
  workspaceName: string;
  mode: WorkspaceMode;
  icon: Icon;
  choose: (icon: Icon) => Promise<string | undefined>;
  onRename: () => void;
  onArchive: () => void;
  /** A planning workspace's What Courtyard knows (#481), first in the menu. */
  onKnows?: () => void;
}) {
  /** Whether the Icon sheet is open, or has never been, so it isn't loaded until it's wanted. */
  const [picking, setPicking] = useState<boolean>();
  /** Whether Allowed commands is open, or has never been, so it isn't loaded until it's wanted. */
  const [allowed, setAllowed] = useState<boolean>();
  /** Whether Notify me is open, or has never been, so it isn't loaded until it's wanted. */
  const [notifying, setNotifying] = useState<boolean>();
  /** The ⋯'s, so Allowed commands opens under it, where the menu was. */
  const anchor = useAnchorName();
  return (
    <>
      <OptionsMenu
        label="Workspace options"
        menuLabel={props.workspaceName}
        square
        anchor={anchor}
        choices={[
          ...(props.onKnows === undefined
            ? []
            : [
                {
                  icon: <BookOpen />,
                  name: "What Courtyard knows",
                  note: "Facts, ideas and skills",
                  onPick: props.onKnows,
                },
              ]),
          { icon: <Pencil />, name: "Rename", onPick: props.onRename },
          {
            icon: <WorkspaceIcon icon={props.icon} size="md" />,
            name: "Change icon",
            onPick: () => setPicking(true),
          },
          ...(props.mode === "code"
            ? [
                {
                  icon: <SquareTerminal />,
                  name: "Allowed commands",
                  note: "What sessions run without asking",
                  onPick: () => setAllowed(true),
                },
              ]
            : []),
          {
            icon: <Bell />,
            name: "Notify me",
            note: "Which notifications you get",
            onPick: () => setNotifying(true),
          },
          {
            icon: <Archive />,
            name: "Archive",
            note: "Hidden, never deleted",
            onPick: props.onArchive,
          },
        ]}
      />
      {allowed !== undefined && (
        <Suspense>
          <AllowedCommandsSheet
            workspaceId={props.workspaceId}
            workspaceName={props.workspaceName}
            anchor={anchor}
            open={allowed}
            onClose={() => setAllowed(false)}
          />
        </Suspense>
      )}
      {notifying !== undefined && (
        <Suspense>
          <NotifyMeSheet
            workspaceId={props.workspaceId}
            workspaceName={props.workspaceName}
            open={notifying}
            onClose={() => setNotifying(false)}
          />
        </Suspense>
      )}
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
