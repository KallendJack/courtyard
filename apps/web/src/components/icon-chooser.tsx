import type { WorkspaceIcon as Icon } from "@courtyard/contract";
import { lazy, Suspense, useState } from "react";
import { IconButton } from "./button.tsx";
import { WorkspaceIcon } from "./workspace-icon.tsx";

// Loaded when the owner first opens it.
const IconSheet = lazy(() => import("./icon-sheet.tsx"));

/**
 * A workspace's icon on its page, which opens the Icon sheet to pick another (#210). `choose`
 * returns an error to show, or nothing once the icon is kept.
 */
export function IconChooser(props: {
  workspaceName: string;
  icon: Icon;
  choose: (icon: Icon) => Promise<string | undefined>;
}) {
  /** Whether the sheet is open, or has never been, so it isn't loaded until it's wanted. */
  const [open, setOpen] = useState<boolean>();
  return (
    <>
      <span className="-m-1.5 flex">
        <IconButton
          label="Change icon"
          size="sm"
          expanded={open === true}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          icon={<WorkspaceIcon icon={props.icon} size="sm" />}
        />
      </span>
      {open !== undefined && (
        <Suspense>
          <IconSheet
            workspaceName={props.workspaceName}
            icon={props.icon}
            open={open}
            onClose={() => setOpen(false)}
            choose={props.choose}
          />
        </Suspense>
      )}
    </>
  );
}
