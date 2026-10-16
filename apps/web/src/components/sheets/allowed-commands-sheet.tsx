import {
  type AllowedCommand,
  type AllowedCommandRemoval,
  AllowedCommands,
  type WorkspaceId,
} from "@courtyard/contract";
import { useAction } from "@/hooks/use-action";
import { alwaysWords } from "@/lib/always-words";
import { fromWorker, sendJson } from "../../api/worker.ts";
import { describeWhen } from "../../lib/when.ts";
import { Button } from "../buttons/button.tsx";
import { FormError } from "../forms/form-error.tsx";
import { createKept, PlaceholderRows, useKept } from "../layout/kept.tsx";
import { placeUnder } from "../layout/place-under.ts";
import { describeProblem } from "../layout/problems.tsx";
import { Scroller } from "../layout/scroller.tsx";
import { useDialog } from "../layout/use-dialog.ts";

// The calls are here, with the sheet, so they stay off the first load.

const pathOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/allowed-commands`;

/** Each workspace's Allowed commands, as last known, so the sheet opens with them at once. */
const KEPT = createKept<readonly AllowedCommand[]>();

/** Under the ⋯, where its menu was, its right edge level with the ⋯'s. */
const UNDER = { side: "right", gap: 8, width: 440 } as const;

/**
 * Workspace ⋯ → Allowed commands (#185; Paper, "Tablet · Workspace ⋯ Allowed commands"): what
 * the owner allowed always in a code workspace from an approval, newest first, not the default
 * allowlist; each says when and from which session, with Remove, after which its sessions ask
 * again. Under the ⋯, where its menu was. Loaded when it first opens.
 */
export default function AllowedCommandsSheet(props: {
  workspaceId: WorkspaceId;
  workspaceName: string;
  /** The ⋯'s anchor name, which it opens under. */
  anchor: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useDialog(props.open, props.onClose);
  const commands = useKept(KEPT, {
    key: props.workspaceId,
    asking: props.open,
    load: async () => {
      const loaded = await fromWorker(pathOf(props.workspaceId), AllowedCommands);
      return loaded.kind === "loaded" ? loaded.data.commands : undefined;
    },
  });
  const remove = useAction(async (allows: AllowedCommandRemoval["allows"]) => {
    const removed = await sendJson({
      path: `${pathOf(props.workspaceId)}/remove`,
      body: { allows } satisfies AllowedCommandRemoval,
      schema: AllowedCommands,
    });
    if (removed.kind !== "loaded") return describeProblem(removed).body;
    KEPT.set(props.workspaceId, removed.data.commands);
    return undefined;
  });

  return (
    <dialog
      {...dialog}
      aria-label={`Allowed commands · ${props.workspaceName}`}
      style={placeUnder(props.anchor, UNDER)}
      className="fixed m-0 flex-col rounded-tile border border-input bg-popover text-popover-foreground shadow-raised backdrop:bg-card/60 open:flex"
    >
      {props.open && (
        <>
          <div className="flex flex-col gap-1.5 px-5 pt-5 pb-3">
            <h2 className="display-section text-card-title tracking-[-0.015em] text-foreground">
              Allowed commands
            </h2>
            <p className="text-meta text-muted-foreground">
              What you allowed always in this workspace. Sessions run these without asking.
            </p>
          </div>
          <Scroller className="min-h-0 px-5">
            {commands === undefined ? (
              <PlaceholderRows count={2} />
            ) : commands.length === 0 ? (
              <p className="py-2 text-meta text-muted-foreground">
                Nothing yet. Allow always on an approval adds its command here.
              </p>
            ) : (
              <ul aria-label="Allowed commands" className="flex flex-col gap-1.5">
                {commands.map((command) => {
                  const words = alwaysWords(command.allows);
                  return (
                    <li
                      key={words}
                      className="flex min-h-14 items-center gap-3 rounded-row bg-secondary px-3.5 py-2.5"
                    >
                      <span className="flex min-w-0 grow flex-col gap-0.5">
                        <code className="font-mono text-sm font-bold wrap-anywhere text-foreground">
                          {words}
                        </code>
                        <span className="text-meta text-muted-foreground">
                          {describeWhen(command.at)}
                          {command.from === undefined ? "" : ` · from ${command.from.title}`}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Remove ${words}`}
                        busy={remove.running?.[0] === command.allows}
                        busyLabel="Removing…"
                        waiting={remove.busy && remove.running?.[0] !== command.allows}
                        onClick={() => void remove.run(command.allows)}
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Scroller>
          <div className="flex flex-col gap-2 px-5 pt-3 pb-5">
            <FormError message={remove.error} />
            <p className="text-meta text-muted-foreground">
              Kept in this workspace's settings, never in the repo. Ones allowed for one session end
              with it.
            </p>
          </div>
        </>
      )}
    </dialog>
  );
}
