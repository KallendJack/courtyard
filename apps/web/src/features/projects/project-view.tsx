import { nextStepOf, type Project, type WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { BackLink } from "@/components/buttons/back-link";
import { useCarryOn } from "./carry-on.ts";
import { notReadyWords, OpenInFabrication, ProjectSteps, WHO } from "./project-steps.tsx";

/**
 * A project on its workspace's page (#603, #710; Paper, "Tablet · Project page: steps (#710)"):
 * the way back to Home's projects, its name and goal, what's next (its first step not done) with
 * Carry on, its steps and its decisions. Calm: no warnings, no nudges.
 */
export function ProjectView(props: { workspaceId: WorkspaceId; project: Project }) {
  const { workspaceId, project } = props;
  const carryOn = useCarryOn(workspaceId);
  const next = nextStepOf(project);
  const nextLine =
    next === undefined
      ? undefined
      : (notReadyWords(next) ??
        [WHO[next.who].label, next.detail].filter((said) => said !== undefined).join(" · "));
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
              <p className="text-meta font-medium text-primary-text">{nextLine}</p>
            </div>
            {next.build !== undefined && (
              <OpenInFabrication workspaceId={workspaceId} build={next.build} />
            )}
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
      <ProjectSteps workspaceId={workspaceId} project={project} next={next} />
    </section>
  );
}
