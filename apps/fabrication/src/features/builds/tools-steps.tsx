import type { DerivedBuild } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { listed, toolsNeeded } from "./words.ts";

/**
 * The tools the steps need against what's to hand (#698): each once, with the steps it's for;
 * what isn't to hand in gold, since it needs the owner.
 */
export function ToolsList(props: { derived: DerivedBuild }) {
  const tools = toolsNeeded(props.derived);
  const missing = tools.filter((tool) => !tool.toHand).length;
  return (
    <section aria-label="Tools" className="flex flex-col gap-1">
      <CapsLabel tone={missing === 0 ? "muted" : "warning"}>
        {missing === 0 ? `All ${tools.length} to hand` : `${missing} not to hand`}
      </CapsLabel>
      <ul className="flex flex-col">
        {tools.map((tool) => (
          <li
            key={tool.tool}
            className="flex items-center gap-3 border-b border-border py-2.5 text-interface"
          >
            <span className="min-w-0 flex-1 font-semibold text-foreground">{tool.name}</span>
            <span className="shrink-0 text-meta text-muted-foreground">
              {tool.steps.length === 1 ? "Step" : "Steps"} {listed(tool.steps.map(String))}
            </span>
            <span
              className={classes(
                "w-24 shrink-0 text-right text-meta font-bold",
                tool.toHand ? "text-success" : "text-warning",
              )}
            >
              {tool.toHand ? "To hand" : "Not to hand"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The steps, in order (#698): each with its time, whether it needs a helper, and the parts it uses,
 * whose letters light the part as tapping it anywhere does. How each is done is #699's.
 */
export function StepsList(props: {
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
}) {
  return (
    <ol aria-label="Steps" className="flex flex-col">
      {props.derived.steps.map((step) => (
        <li key={step.number} className="flex items-start gap-3 border-b border-border py-2.5">
          <span className="w-6 shrink-0 font-mono text-meta text-muted-foreground">
            {step.number}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-interface font-semibold text-foreground">{step.title}</span>
            <span className="text-meta text-muted-foreground">
              {step.minutes} min{step.helper ? " · needs a helper" : ""}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            {step.parts.map((label) => (
              <button
                key={label}
                type="button"
                aria-label={`Part ${label}`}
                aria-pressed={props.lit === label}
                onClick={() => props.pick(label)}
                className={classes(
                  "flex size-6 items-center justify-center rounded-full font-mono text-caption font-bold",
                  props.lit === label
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}
