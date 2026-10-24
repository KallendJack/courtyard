import type { MoveReview as Review, WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { TickBox } from "@/components/forms/tick-box";
import { describeProblem } from "../../components/layout/problems.tsx";
import { loadKeptHome } from "../planning-home/api.ts";
import { moveTicked } from "./api.ts";

/**
 * A planning workspace's move review on Home (#603; Paper, "Tablet · Move review: guides to
 * projects and parts, ticked (#603)"), in place of its subject and projects until it's done: each
 * move, what moves where and what it becomes, ticked to begin with. Move N makes the ticked ones,
 * each one change with Undo; with none ticked, Leave as they are ends the review with nothing
 * moved. A move that couldn't be made says why, and stays for another go.
 */
export function MoveReview(props: { workspaceId: WorkspaceId; review: Review }) {
  const { workspaceId, review } = props;
  const router = useRouter();
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set());
  const ticked = review.moves.filter(({ id }) => !unticked.has(id)).map(({ id }) => id);
  const move = useAction(async () => {
    const made = await moveTicked(workspaceId, ticked);
    if (made.kind !== "loaded") return describeProblem(made).body;
    setUnticked(new Set());
    // Home, and the page's documents and Things, as the moves left them.
    await Promise.all([loadKeptHome(workspaceId), router.invalidate()]);
    const { left } = made.data;
    return left.length === 0
      ? undefined
      : left.map(({ title, problem }) => `${title} wasn't moved: ${problem}`).join(" ");
  });
  const things = review.moves.length;

  return (
    <section aria-labelledby="move-review-title" className="flex flex-col gap-2.5 pt-1">
      <div className="flex flex-col gap-1 px-0.5 pt-1 pb-1.5">
        <p className="text-meta font-semibold text-primary-text">Your guides, sorted</p>
        <h2 id="move-review-title" className="display-title text-title">
          {things === 1
            ? "Move 1 thing where it belongs"
            : `Move ${things} things where they belong`}
        </h2>
      </div>
      <ul aria-label="Moves" className="flex flex-col gap-2.5">
        {review.moves.map(({ id, title, about }) => (
          <li key={id} className="rounded-row bg-secondary">
            <label
              htmlFor={`move-${id}`}
              className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5"
            >
              <TickBox
                id={`move-${id}`}
                big
                checked={!unticked.has(id)}
                labelledBy={`move-${id}-title`}
                describedBy={`move-${id}-about`}
                onChange={(checked) =>
                  setUnticked((was) => {
                    const now = new Set(was);
                    if (checked) now.delete(id);
                    else now.add(id);
                    return now;
                  })
                }
              />
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span id={`move-${id}-title`} className="text-interface font-bold text-foreground">
                  {title}
                </span>
                <span id={`move-${id}-about`} className="text-meta font-medium text-foreground/75">
                  {about}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 pt-1.5">
        <Button
          size="lg"
          onClick={() => void move.run()}
          busy={move.busy}
          busyLabel={ticked.length === 0 ? "Leaving…" : "Moving…"}
        >
          {ticked.length === 0 ? "Leave as they are" : `Move ${ticked.length}`}
        </Button>
        <p className="text-meta font-medium text-muted-foreground">
          Untick any to leave as it is · each move has Undo
        </p>
      </div>
      <FormError message={move.error} />
    </section>
  );
}
