import { type NotifyMe, NotifyMeSetting, type WorkspaceId } from "@courtyard/contract";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { fromWorker, sendJson } from "../../api/worker.ts";
import { RadioRow } from "../forms/radio-row.tsx";
import { DialogCard } from "../layout/dialog-card.tsx";
import { describeProblem } from "../layout/problems.tsx";

// The calls are here, with the sheet, so they stay off the first load.

const pathOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/notify`;

/** Each workspace's Notify me, as last known, so the sheet opens with it at once. */
const KEPT = createKept<NotifyMe>();

/** The three choices, as the sheet says them. */
const CHOICES: readonly {
  readonly notify: NotifyMe;
  readonly label: string;
  readonly detail: string;
}[] = [
  {
    notify: "everything",
    label: "Everything",
    detail: "Approvals, replies, every finished or failed turn, failing checks",
  },
  {
    notify: "needs-me",
    label: "Only what needs me",
    detail: "Approvals and failures. Planning workspaces start here",
  },
  { notify: "nothing", label: "Nothing", detail: "It still shows in Needs you on Home" },
];

/**
 * Workspace ⋯ → Notify me (#493; Paper, "Notify me"): what the workspace's notifications tell the
 * owner of, Everything, Only what needs me or Nothing, rising from the bottom. A tap on one keeps
 * it and closes the sheet; the worker decides what to send from it. Loaded when it first opens.
 */
export default function NotifyMeSheet(props: {
  workspaceId: WorkspaceId;
  workspaceName: string;
  open: boolean;
  onClose: () => void;
}) {
  const notify = useKept(KEPT, {
    key: props.workspaceId,
    asking: props.open,
    load: async () => {
      const loaded = await fromWorker(pathOf(props.workspaceId), NotifyMeSetting);
      return loaded.kind === "loaded" ? loaded.data.notify : undefined;
    },
  });
  const pick = useAction(async (picked: NotifyMe) => {
    const kept = await sendJson({
      path: pathOf(props.workspaceId),
      body: { notify: picked } satisfies NotifyMeSetting,
      schema: NotifyMeSetting,
    });
    if (kept.kind !== "loaded") return describeProblem(kept).body;
    KEPT.set(props.workspaceId, kept.data.notify);
    props.onClose();
    return undefined;
  });
  /** The one picked shows chosen at once, while it's kept. */
  const chosen = pick.running?.[0] ?? notify;

  return (
    <DialogCard
      title="Notify me"
      over={props.workspaceName}
      rises="always"
      open={props.open}
      onClose={props.onClose}
    >
      {chosen === undefined ? (
        <PlaceholderRows count={3} />
      ) : (
        <fieldset aria-label="Notify me" aria-busy={pick.busy} className="flex flex-col gap-2">
          {CHOICES.map((choice) => (
            <RadioRow
              key={choice.notify}
              name="notify-me"
              label={choice.label}
              detail={choice.detail}
              chosen={choice.notify === chosen}
              onChoose={() => !pick.busy && void pick.run(choice.notify)}
            />
          ))}
        </fieldset>
      )}
      <FormError message={pick.error} />
    </DialogCard>
  );
}
