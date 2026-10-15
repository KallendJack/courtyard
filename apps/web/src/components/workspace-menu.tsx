import type { WorkspaceIcon as Icon } from "@courtyard/contract";
import { Archive, Pencil } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { OptionsMenu } from "./options-menu.tsx";
import { WorkspaceIcon } from "./workspace-icon.tsx";

// Loaded when the owner first picks Change icon.
const IconSheet = lazy(() => import("./icon-sheet.tsx"));

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
  /** Whether the Icon sheet is open, or has never been, so it isn't loaded until it's wanted. */
  const [picking, setPicking] = useState<boolean>();
  return (
    <>
      <OptionsMenu
        label="Workspace options"
        menuLabel={props.workspaceName}
        square
        choices={[
          { icon: <Pencil />, name: "Rename", onPick: props.onRename },
          {
            icon: <WorkspaceIcon icon={props.icon} size="md" />,
            name: "Change icon",
            onPick: () => setPicking(true),
          },
          {
            icon: <Archive />,
            name: "Archive",
            note: "Hidden, never deleted",
            onPick: props.onArchive,
          },
        ]}
      />
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
