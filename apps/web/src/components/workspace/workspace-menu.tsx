import type { WorkspaceIcon as Icon, WorkspaceId, WorkspaceMode } from "@courtyard/contract";
import { Archive, Ban, Pencil, SquareTerminal } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { OptionsMenu } from "../buttons/options-menu.tsx";
import { useAnchorName } from "../layout/place-under.ts";
import { WorkspaceIcon } from "./workspace-icon.tsx";

// Loaded when the owner first picks Change icon, Allowed commands or Blocked shops.
const IconSheet = lazy(() => import("../sheets/icon-sheet.tsx"));
const AllowedCommandsSheet = lazy(() => import("../sheets/allowed-commands-sheet.tsx"));
const BlockedShopsSheet = lazy(() => import("../sheets/blocked-shops-sheet.tsx"));

/**
 * One quiet ⋯ beside a code workspace's name (#333; Paper, "Tablet · Workspace ⋯: rename, icon,
 * archive"), opening a small sheet under it: Rename, Change icon (the Icon sheet), Allowed commands
 * (what the owner allowed always, #185), in a planning workspace Blocked shops (its wanted list's,
 * #245), and Archive, so the title area keeps only the name while nothing the page could do goes
 * away. `choose` returns an error to show, or nothing once the icon is kept.
 */
export function WorkspaceMenu(props: {
  workspaceId: WorkspaceId;
  workspaceName: string;
  mode: WorkspaceMode;
  icon: Icon;
  choose: (icon: Icon) => Promise<string | undefined>;
  onRename: () => void;
  onArchive: () => void;
}) {
  /** Whether the Icon sheet is open, or has never been, so it isn't loaded until it's wanted. */
  const [picking, setPicking] = useState<boolean>();
  /** Whether Allowed commands is open, or has never been, so it isn't loaded until it's wanted. */
  const [allowed, setAllowed] = useState<boolean>();
  /** Whether Blocked shops is open, or has never been, so it isn't loaded until it's wanted. */
  const [blocked, setBlocked] = useState<boolean>();
  /** The ⋯'s, so Allowed commands and Blocked shops open under it, where the menu was. */
  const anchor = useAnchorName();
  return (
    <>
      <OptionsMenu
        label="Workspace options"
        menuLabel={props.workspaceName}
        square
        anchor={anchor}
        choices={[
          { icon: <Pencil />, name: "Rename", onPick: props.onRename },
          {
            icon: <WorkspaceIcon icon={props.icon} size="md" />,
            name: "Change icon",
            onPick: () => setPicking(true),
          },
          {
            icon: <SquareTerminal />,
            name: "Allowed commands",
            note: "What sessions run without asking",
            onPick: () => setAllowed(true),
          },
          ...(props.mode === "planning"
            ? [
                {
                  icon: <Ban />,
                  name: "Blocked shops",
                  note: "Shops the wanted list skips",
                  onPick: () => setBlocked(true),
                },
              ]
            : []),
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
      {blocked !== undefined && (
        <Suspense>
          <BlockedShopsSheet
            workspaceId={props.workspaceId}
            workspaceName={props.workspaceName}
            anchor={anchor}
            open={blocked}
            onClose={() => setBlocked(false)}
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
