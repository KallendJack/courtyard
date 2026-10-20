import type { PinnedPart, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { Button } from "@/components/buttons/button";
import { ButtonLink } from "@/components/buttons/button-link";
import { FormError } from "@/components/forms/form-error";
import { CapsLabel } from "@/components/layout/caps-label";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { boughtInWords } from "../things/words.ts";
import { markThing } from "./api.ts";

/** What's fitted, in a few words: a part's brand and size. */
export const fittedOf = (thing: ThingSummary | undefined) =>
  [thing?.brand, thing?.size].filter((detail) => detail !== undefined).join(" · ");

/** What a part needs, in a few words: its next step, else that it's to get or to replace. */
const needsLine = (part: Pick<PinnedPart, "needs" | "status">) =>
  part.needs ?? (part.status === "want" ? "To get" : part.status === "replace" ? "To replace" : "");

/**
 * A part's card at the foot of the Breakdown view, opened from its label or its pin (#565; Paper,
 * "Tablet · Planning Home: the bike, part by part (#565)"): the part's name, what's fitted (its
 * brand and size), the rest of its details, what it needs in gold when it needs something, and
 * for one with no pin yet, how to place it. Open goes to its whole card, Ask about it starts a session about it, and Done it is for one that
 * needs something.
 */
export function PartCard(props: {
  workspaceId: WorkspaceId;
  part: PinnedPart;
  /** The part as the Things list has it, for its details. */
  thing: ThingSummary | undefined;
  /** It has no pin yet, so a tap on the photo places it: the card says so. */
  placing: boolean;
  /** Opens the box to start a session about the part. */
  ask: () => void;
  /** Once Done it is saved: Home loads again. */
  onDone: () => Promise<void>;
}) {
  const { part, thing } = props;
  const done = useAction(async () => {
    const marked = await markThing(props.workspaceId, part.thing, "done");
    if (marked.kind !== "loaded") return describeProblem(marked).body;
    await props.onDone();
    return undefined;
  });
  const fitted = fittedOf(thing);
  const details = [
    thing?.condition,
    thing?.bought === undefined ? undefined : `bought ${boughtInWords(thing.bought)}`,
    thing?.where,
  ].filter((detail) => detail !== undefined);
  const needs = needsLine(part);

  return (
    <section
      aria-label={`${part.name}'s card`}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-primary/60 bg-primary/10 px-4 py-3"
    >
      <div className="flex min-w-0 grow basis-60 flex-col gap-0.5">
        <CapsLabel tone="primary">{part.name}</CapsLabel>
        <p className="text-interface font-bold text-foreground">
          {fitted === "" ? part.name : fitted}
        </p>
        {details.length > 0 && (
          <p className="text-meta text-muted-foreground">{details.join(" · ")}</p>
        )}
        {needs !== "" && <p className="text-meta font-semibold text-warning">{needs}</p>}
        {props.placing && (
          <p className="text-meta font-medium text-primary-text">
            Tap the photo where the {part.name} is
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {part.flagged && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void done.run()}
            busy={done.busy}
            busyLabel="Saving…"
          >
            Done it
          </Button>
        )}
        <ButtonLink
          variant="outline"
          size="sm"
          to="/workspaces/$workspaceId/things/$slug"
          params={{ workspaceId: props.workspaceId, slug: part.thing }}
        >
          Open
        </ButtonLink>
        <Button variant="outline" size="sm" onClick={props.ask}>
          Ask about it
        </Button>
      </div>
      <FormError message={done.error} />
    </section>
  );
}
