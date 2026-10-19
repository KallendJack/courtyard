import {
  type BlockedShop,
  BlockedShops,
  type ShopUnblock,
  type WorkspaceId,
} from "@courtyard/contract";
import { useAction } from "@/hooks/use-action";
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
  `/workspaces/${encodeURIComponent(workspaceId)}/blocked-shops`;

/** Each workspace's blocked shops, as last known, so the sheet opens with them at once. */
const KEPT = createKept<readonly BlockedShop[]>();

/** Under the ⋯, where its menu was, its right edge level with the ⋯'s. */
const UNDER = { side: "right", gap: 8, width: 440 } as const;

/**
 * Workspace ⋯ → Blocked shops (#245; Paper, "Tablet · Workspace ⋯ Blocked shops"): the shops the
 * owner said not to use for a planning workspace's wanted list, each with when and what they said,
 * and Unblock, after which the next price check can pick from it again. Under the ⋯, where its
 * menu was. Loaded when it first opens.
 */
export default function BlockedShopsSheet(props: {
  workspaceId: WorkspaceId;
  workspaceName: string;
  /** The ⋯'s anchor name, which it opens under. */
  anchor: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useDialog(props.open, props.onClose);
  const shops = useKept(KEPT, {
    key: props.workspaceId,
    asking: props.open,
    load: async () => {
      const loaded = await fromWorker(pathOf(props.workspaceId), BlockedShops);
      return loaded.kind === "loaded" ? loaded.data.shops : undefined;
    },
  });
  const unblock = useAction(async (shop: string) => {
    const unblocked = await sendJson({
      path: `${pathOf(props.workspaceId)}/unblock`,
      body: { shop } satisfies ShopUnblock,
      schema: BlockedShops,
    });
    if (unblocked.kind !== "loaded") return describeProblem(unblocked).body;
    KEPT.set(props.workspaceId, unblocked.data.shops);
    return undefined;
  });

  return (
    <dialog
      {...dialog}
      aria-label={`Blocked shops · ${props.workspaceName}`}
      style={placeUnder(props.anchor, UNDER)}
      className="fixed m-0 flex-col rounded-tile border border-input bg-popover text-popover-foreground shadow-raised backdrop:bg-card/60 open:flex"
    >
      {props.open && (
        <>
          <div className="flex flex-col gap-1.5 px-5 pt-5 pb-3">
            <h2 className="display-section text-card-title tracking-[-0.015em] text-foreground">
              Blocked shops
            </h2>
            <p className="text-meta text-muted-foreground">
              Shops you said not to use. Picks and price checks skip them.
            </p>
          </div>
          <Scroller className="min-h-0 px-5">
            {shops === undefined ? (
              <PlaceholderRows count={2} />
            ) : shops.length === 0 ? (
              <p className="py-2 text-meta text-muted-foreground">
                None yet. Say "not from" a shop in a session to block it.
              </p>
            ) : (
              <ul aria-label="Blocked shops" className="flex flex-col gap-1.5">
                {shops.map((blocked) => (
                  <li
                    key={blocked.shop}
                    className="flex min-h-14 items-center gap-3 rounded-row bg-secondary px-3.5 py-2.5"
                  >
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="text-sm font-bold wrap-anywhere text-foreground">
                        {blocked.shop}
                      </span>
                      <span className="text-meta text-muted-foreground">
                        Since {describeWhen(blocked.since)}
                        {blocked.said === undefined ? "" : ` · you said "${blocked.said}"`}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Unblock ${blocked.shop}`}
                      busy={unblock.running?.[0] === blocked.shop}
                      busyLabel="Unblocking…"
                      waiting={unblock.busy && unblock.running?.[0] !== blocked.shop}
                      onClick={() => void unblock.run(blocked.shop)}
                    >
                      Unblock
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Scroller>
          <div className="flex flex-col gap-2 px-5 pt-3 pb-5">
            <FormError message={unblock.error} />
            <p className="text-meta text-muted-foreground">
              Unblock a shop and the next price check can pick from it again.
            </p>
          </div>
        </>
      )}
    </dialog>
  );
}
