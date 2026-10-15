import { type WorkspaceIcon as Icon, WorkspaceIcon as Icons } from "@courtyard/contract";
import { useId } from "react";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { FormError } from "./form-error.tsx";
import { HandheldSheet } from "./handheld-sheet.tsx";
import { WorkspaceIcon } from "./workspace-icon.tsx";
import { ICONS } from "./workspace-marks.tsx";

/**
 * The Icon sheet (#210, Paper board Handheld · 36): a workspace's icon to pick from the set, the
 * one it has ringed in violet. Picking one keeps it and closes the sheet; `choose` returns an
 * error to show, or nothing once it's kept. A Handheld sheet on a touch screen, from beside the
 * right rail or the bottom; a sheet from the bottom on a desktop. Loaded when it first opens.
 */
export default function IconSheet(props: {
  workspaceName: string;
  icon: Icon;
  open: boolean;
  onClose: () => void;
  choose: (icon: Icon) => Promise<string | undefined>;
}) {
  const save = useAction(props.choose);
  const radio = useId();

  const choose = async (icon: Icon) => {
    if (await save.run(icon)) props.onClose();
  };
  const body = (
    <>
      <p className="text-meta text-muted-foreground">
        Shows on its tile in the rails. Courtyard suggests one from the name; change it any time.
      </p>
      <div
        role="radiogroup"
        aria-label="Icon"
        aria-busy={save.busy}
        className="grid w-full max-w-92 grid-cols-5 gap-2.5"
      >
        {Icons.options.map((icon) => {
          const chosen = icon === props.icon;
          const { name } = ICONS[icon];
          return (
            <label
              key={icon}
              title={name}
              className={classes(
                "flex aspect-square cursor-pointer items-center justify-center rounded-card select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                chosen ? "bg-muted ring-2 ring-primary" : "bg-secondary active:bg-accent",
              )}
            >
              <input
                type="radio"
                name={radio}
                value={icon}
                aria-label={name}
                checked={chosen}
                // While one is being kept, another tap waits for it (#330).
                onChange={() => {
                  if (!save.busy) void choose(icon);
                }}
                className="sr-only"
              />
              <WorkspaceIcon icon={icon} size="lg" open={chosen} />
            </label>
          );
        })}
      </div>
      <p className="text-meta font-semibold text-placeholder">
        A small set of plain line icons, the same style everywhere.
      </p>
      <FormError message={save.error} />
    </>
  );
  return (
    <HandheldSheet
      title="Icon"
      aside={props.workspaceName}
      open={props.open}
      onClose={props.onClose}
      fits="top"
    >
      {body}
    </HandheldSheet>
  );
}
