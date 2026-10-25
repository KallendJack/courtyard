import type { ChangeId, ThingList, ThingStatus, WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { SegmentedChoice } from "@courtyard/ui/forms/segmented-choice.tsx";
import { CARD, SectionTitle } from "@courtyard/ui/layout/page.tsx";
import { useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { describeProblem } from "../../components/layout/problems.tsx";
import { JustDeleted } from "../changes/just-deleted.tsx";
import { addThing } from "./api.ts";
import { ThingsScope } from "./scope.tsx";
import { ThingForm } from "./thing-form.tsx";
import { ThingRows } from "./thing-rows.tsx";
import { STATUS_CHOICES } from "./words.ts";

type Filter = "all" | ThingStatus;

/**
 * A workspace's Things on its page (ADR 0020), below its context file: a row each, parts under the
 * Thing they're part of, filtered by status, and Add Thing. Hidden until there's one, so a new
 * workspace looks as it did, unless one was just deleted (that shows with Undo) or one's being added.
 */
export function ThingsSection(props: {
  workspaceId: WorkspaceId;
  list: ThingList;
  /** A Thing just deleted from its card, and the change that deleted it, for Undo. */
  deleted?: { readonly name: string; readonly change: ChangeId | undefined };
  /** Once a delete is undone: the page loads the list again. */
  onUndone: () => Promise<void>;
  /** Opened with Add Thing's form open: from the rail's Add (#481), even with no Things yet. */
  adding?: boolean;
}) {
  const { workspaceId, list, deleted } = props;
  const { things } = list;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(props.adding === true);
  if (things.length === 0 && list.problems.length === 0 && deleted === undefined && !adding) {
    return null;
  }

  const count = (status: ThingStatus) => things.filter((thing) => thing.status === status).length;
  const options = [
    { value: "all", label: "All", count: things.length },
    ...STATUS_CHOICES.map((choice) => ({ ...choice, count: count(choice.value) })),
  ] satisfies { value: Filter; label: string; count: number }[];
  const shown = filter === "all" ? things : things.filter((thing) => thing.status === filter);

  return (
    <ThingsScope>
      <section aria-label="Things" className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <SectionTitle>Things</SectionTitle>
          <Button variant="outline" size="sm" onClick={() => setAdding((was) => !was)}>
            <Plus className="size-3.5" />
            <span className="max-md:hidden">Add Thing</span>
            <span className="md:hidden">Add</span>
          </Button>
        </div>
        {adding && (
          <div className="mt-3 mb-2">
            <ThingForm
              parents={things.filter((thing) => thing.partOf === undefined)}
              hasParts={false}
              save={async (form, photo) => {
                const added = await addThing(workspaceId, form, photo);
                if (added.kind !== "loaded") return describeProblem(added).body;
                await router.invalidate();
                return undefined;
              }}
              onDone={() => setAdding(false)}
            />
          </div>
        )}
        {deleted !== undefined && (
          <JustDeleted name={deleted.name} change={deleted.change} onUndone={props.onUndone} />
        )}
        {things.length > 0 && (
          <div className="pt-3 pb-3">
            <SegmentedChoice label="Show" options={options} value={filter} onChange={setFilter} />
          </div>
        )}
        <ThingRows workspaceId={workspaceId} things={shown} all={things} label="Things" />
        {list.problems.map((problem) => (
          <p key={problem.path} className="mt-2 text-meta text-muted-foreground wrap-anywhere">
            {problem.path} can't be read as a Thing: {problem.problem}
          </p>
        ))}
      </section>
    </ThingsScope>
  );
}
