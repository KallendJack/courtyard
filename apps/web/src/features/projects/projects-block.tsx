import { nextStepOf, type Project, type WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { Link } from "@tanstack/react-router";
import { Block, BlockRow, BlockRows } from "@/components/layout/home-block";
import { projectHash } from "./api.ts";
import { useCarryOn } from "./carry-on.ts";

/**
 * A planning workspace's projects on Home (#603; Paper, "Tablet · Mountain biking Home: the bike,
 * then projects (#603)"): under its main subject, each project being carried on, by name (which
 * opens it), its next step, and Carry on, which starts a session that belongs to it. Two rows tall
 * under the subject, more scrolling inside; with no subject, it fills Home.
 */
export function ProjectsBlock(props: {
  workspaceId: WorkspaceId;
  projects: readonly Project[];
  /** Home has no subject to show above it, so it fills Home. */
  alone: boolean;
}) {
  const carryOn = useCarryOn(props.workspaceId);
  const active = props.projects.filter((project) => project.status === "active");
  if (active.length === 0) return null;
  return (
    <Block label="Projects" {...(props.alone ? { fill: true } : { twoRows: true })}>
      <BlockRows>
        <ul className="flex flex-col gap-1.5">
          {active.map((project) => {
            const next = nextStepOf(project);
            return (
              <BlockRow
                key={project.slug}
                label={project.name}
                title={
                  <Link
                    to="/workspaces/$workspaceId"
                    params={{ workspaceId: props.workspaceId }}
                    hash={projectHash(project.slug)}
                    className="outline-none hover:underline focus-visible:underline"
                  >
                    {project.name}
                  </Link>
                }
                sub={next === undefined ? "Nothing next yet" : `Next: ${next.text}`}
                tone="plain"
                action={
                  <Button
                    variant="outline"
                    size="row"
                    onClick={() => void carryOn.run(project)}
                    busy={carryOn.running?.[0] === project}
                    busyLabel="Starting…"
                    waiting={carryOn.busy && carryOn.running?.[0] !== project}
                  >
                    Carry on
                  </Button>
                }
              />
            );
          })}
        </ul>
      </BlockRows>
      <FormError message={carryOn.error} />
    </Block>
  );
}
