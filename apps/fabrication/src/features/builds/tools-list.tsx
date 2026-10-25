import type { DerivedBuild } from "@courtyard/contract";
import { buttonLook } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Link } from "@tanstack/react-router";
import { listed, toolsNeeded } from "./words.ts";

/**
 * The tools the steps need against what's to hand (#698): each once, with the steps it's for;
 * what isn't to hand in gold, since it needs the owner.
 */
export function ToolsList(props: { derived: DerivedBuild; build: string }) {
  const tools = toolsNeeded(props.derived);
  const missing = tools.filter((tool) => !tool.toHand).length;
  return (
    <section aria-label="Tools" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <CapsLabel tone={missing === 0 ? "muted" : "warning"}>
          {missing === 0 ? `All ${tools.length} to hand` : `${missing} not to hand`}
        </CapsLabel>
        {/* The owner's tools, ticked on Your tools (#707), for any Build. */}
        <Link
          to="/tools"
          search={{ back: props.build }}
          className={buttonLook({ variant: "quietPrimary", size: "xs" })}
        >
          Your tools
        </Link>
      </div>
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
