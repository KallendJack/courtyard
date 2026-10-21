import { drawSpaceMessage, type HomeSubject, type WorkspaceId } from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { startSession } from "../sessions/composer/messages.ts";

type Space = Extract<HomeSubject, { kind: "space" }>;

/** A fact as one sentence of the line: its full stop, if it has none. */
const sentence = (fact: string) => (/[.!?]$/.test(fact) ? fact : `${fact}.`);

/**
 * A space with no floor plan yet, leading its Home (#604; Paper, "Tablet · Garage Home: Draw the
 * garage, then projects (#604)"): where its plan will be, its size as saved; that there's no plan
 * yet; everything a plan is drawn from, as saved; and Draw the garage, named from the workspace,
 * which starts a session holding those measurements, for a floor plan, and opens it. Once it's
 * drawn, the plan is Home's subject in its place.
 */
export function DrawSpace(props: { workspaceId: WorkspaceId; space: Space }) {
  const { workspaceId, space } = props;
  const navigate = useNavigate();
  const draw = useAction(async () => {
    const session = await startSession({
      workspaceId,
      message: { text: drawSpaceMessage(space) },
      files: [],
    });
    if (session.kind !== "loaded") return describeProblem(session).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId, sessionId: session.data.id },
    });
    return undefined;
  });

  return (
    <section
      aria-labelledby="draw-space"
      className="flex shrink-0 flex-col gap-4.5 rounded-card border bg-surface p-4 sm:flex-row sm:items-center"
    >
      {/* Where the plan will be: the floor's size, to scale once it's drawn. */}
      <div
        aria-hidden
        className="flex h-28 w-full shrink-0 items-center justify-center rounded-md border-stroke border-dashed border-input sm:h-62.5 sm:w-37.5"
      >
        <span className="text-center text-label font-semibold text-placeholder">{space.size}</span>
      </div>
      <div className="flex min-w-0 grow flex-col items-start gap-2.5">
        <h2 id="draw-space" className="display-section text-sheet-title">
          No plan of the {space.name} yet
        </h2>
        <p className="text-sm/5 font-medium text-foreground/75">
          Courtyard draws it to scale from what's saved:{" "}
          {space.measurements.map(sentence).join(" ")}
        </p>
        <Button size="lg" onClick={() => void draw.run()} busy={draw.busy} busyLabel="Starting…">
          Draw the {space.name}
        </Button>
        <FormError message={draw.error} />
      </div>
    </section>
  );
}
