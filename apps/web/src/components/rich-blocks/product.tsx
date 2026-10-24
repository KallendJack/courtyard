import { ProductBlock as Product, WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { useKept } from "@courtyard/ui/layout/kept.tsx";
import { useParams } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { useMemo } from "react";
import { addThing, KEPT_THINGS, loadKeptThings, loadThings } from "../../features/things/api.ts";
import { describeProblem } from "../layout/problems.tsx";
import type { DrawingProps } from "./fenced.tsx";
import { RichBlock } from "./rich-block.tsx";

/** The product's JSON, when it's a product Courtyard can draw. */
const productFrom = (source: string) => {
  try {
    const parsed = Product.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const sameName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), "en-GB", { sensitivity: "base" }) === 0;

/**
 * A `product` block (#245; Paper, "Tablet · Session: Add to wanted from an answer"): a product named
 * in an answer, its name and one line about it, with + Add to wanted, which adds a Thing of that
 * name to the workspace's wanted list in one tap, with no model turn; ✓ In Wanted once one of
 * that name is wanted or to replace. JSON that isn't a product shows the fallback.
 */
export default function ProductCard(props: DrawingProps) {
  const product = useMemo(() => productFrom(props.source), [props.source]);
  const params = useParams({ strict: false });
  const named = WorkspaceId.safeParse(params.workspaceId);
  const workspaceId = named.success ? named.data : undefined;
  const things = useKept(KEPT_THINGS, {
    key: workspaceId ?? "",
    asking: workspaceId !== undefined && product !== undefined,
    load: async () => {
      if (workspaceId === undefined) return undefined;
      const loaded = await loadThings(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
  });
  const add = useAction(async (name: string) => {
    if (workspaceId === undefined) return undefined;
    const added = await addThing(workspaceId, { name, status: "want" });
    if (added.kind !== "loaded") return describeProblem(added).body;
    await loadKeptThings(workspaceId);
    return undefined;
  });
  if (product === undefined) return props.fallback;
  const wanted = things?.things.some(
    (thing) => thing.status !== "have" && sameName(thing.name, product.name),
  );

  return (
    <RichBlock>
      <article
        aria-label={product.name}
        className="flex flex-col gap-1.5 rounded-lg border bg-surface py-3 pr-3 pl-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 grow flex-col gap-0.5">
            <span className="text-answer/5 font-bold text-foreground">{product.name}</span>
            {product.about !== undefined && product.about !== "" && (
              <span className="text-meta font-medium text-muted-foreground">{product.about}</span>
            )}
          </div>
          {workspaceId === undefined || things === undefined ? null : wanted === true ? (
            <span className="flex h-9 shrink-0 items-center gap-1.5 px-3.5 text-meta font-semibold text-foreground/80">
              <Check aria-hidden className="size-3.5" />
              In Wanted
            </span>
          ) : (
            <Button
              variant="soft"
              size="sm"
              busy={add.busy}
              busyLabel="Adding…"
              onClick={() => void add.run(product.name)}
            >
              <Plus aria-hidden className="size-3.5" />
              Add to wanted
            </Button>
          )}
        </div>
        <FormError message={add.error} />
      </article>
    </RichBlock>
  );
}
