import { nextStepOf, type Project, type StepKind, type WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { BackLink } from "@/components/buttons/back-link";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { stepDetail } from "./api.ts";
import { useCarryOn } from "./carry-on.ts";

/** Each kind of step's chip, by what its colour means (AGENTS.md): violet open, gold a pro, moss settled. */
const CHIPS: Readonly<Record<StepKind, { label: string; look: string }>> = {
  decided: { label: "Decided", look: "bg-success/12 text-success" },
  "you can do this": { label: "You can do this", look: "bg-primary/12 text-primary-text" },
  "needs a pro": { label: "Needs a pro", look: "bg-warning/10 text-warning" },
};

/**
 * A project on its workspace's page (#603; Paper, "Tablet · Project: turn the garage into an
 * office (#603)"): the way back to Home's projects, its name and goal, what's next with Carry on,
 * and the rest of its steps, each with what it asks of the owner. Calm: no warnings, no nudges.
 */
export function ProjectView(props: { workspaceId: WorkspaceId; project: Project }) {
  const { workspaceId, project } = props;
  const carryOn = useCarryOn(workspaceId);
  const next = nextStepOf(project);
  const rest = project.steps.filter((step) => step !== next);
  return (
    <section aria-labelledby="project-name" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-0.5 pt-1 pb-1.5">
        <BackLink workspaceId={workspaceId} projects />
        <h2 id="project-name" className="display-title text-title wrap-anywhere">
          {project.name}
        </h2>
      </div>
      <div className="flex flex-col gap-2.5">
        {project.goal !== undefined && (
          <p className="text-interface/5.5 font-medium text-foreground/75">{project.goal}</p>
        )}
        {next !== undefined && (
          <section
            aria-label="Next"
            className="flex items-center gap-3 rounded-lg border border-primary/35 bg-primary/12 py-3 pr-2.5 pl-3.5"
          >
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <CapsLabel tone="primary">Next</CapsLabel>
              <p className="text-interface font-bold text-foreground">{next.text}</p>
              <p className="text-meta font-medium text-primary-text">{stepDetail(next)}</p>
            </div>
            <Button
              onClick={() => void carryOn.run(project)}
              busy={carryOn.busy}
              busyLabel="Starting…"
            >
              Carry on
            </Button>
          </section>
        )}
        <FormError message={carryOn.error} />
      </div>
      {rest.length > 0 && (
        <section aria-labelledby="project-steps" className="flex flex-col gap-1">
          <div className="px-0.5 py-1">
            <CapsLabel tone="muted" heading={{ level: 3, id: "project-steps" }}>
              Steps
            </CapsLabel>
          </div>
          <ul className="flex flex-col">
            {rest.map((step) => (
              <li key={`${step.kind}:${step.text}`} className="flex items-center gap-3 px-1 py-2">
                <span className="flex w-29 shrink-0">
                  <span
                    className={classes(
                      "flex h-6 items-center rounded-full px-2.5 text-label/3.5 font-bold",
                      CHIPS[step.kind].look,
                    )}
                  >
                    {CHIPS[step.kind].label}
                  </span>
                </span>
                <span className="min-w-0 text-sm/5 font-semibold text-foreground/90">
                  {step.detail === undefined ? step.text : `${step.text} · ${step.detail}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
