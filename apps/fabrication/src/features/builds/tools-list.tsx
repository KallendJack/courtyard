import type { ChangeId, DerivedBuild } from "@courtyard/contract";
import { Button, buttonLook } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { saveTools, undoTools, yourTools } from "@/api/fabrication";
import { withHad } from "../tools/picks.ts";
import type { Progress } from "./progress.ts";
import { bitSizes, listed, type ToolNeeded, toolsNeeded, toSort } from "./words.ts";

/** How to tell a drill bit's size, for the owner who asked (#763). */
const BIT_SIZE_HELP =
  "It's stamped on the bit's smooth shank, or printed by its slot in the case. If it's worn off, hold the shank against a ruler: 3 mm and 7 mm are easy to tell apart. Or push the bit through a hole you know: an M6 bolt passes through a 7 mm bit's hole with a little play.";

/** Its steps, as a row says them: "Fit the top · step 11". */
const stepsLine = (tool: ToolNeeded) =>
  `${tool.firstStep} · ${tool.steps.length === 1 ? "step" : "steps"} ${listed(tool.steps.map(String))}`;

/** A tool to sort: what's missing, what to do, and its actions. */
function ToSort(props: {
  tool: ToolNeeded;
  buying: boolean;
  have: (tool: ToolNeeded, bits: ToolNeeded["bits"]) => Promise<void>;
  buy: (tool: string) => void;
}) {
  const { tool } = props;
  const [help, setHelp] = useState(false);
  // The bits the owner's set isn't known to have.
  const bits = tool.bits.filter((bit) => bit.have !== true);
  const plural = bits.length > 1;
  // A set the owner has, whose sizes aren't known yet: to check, not to buy.
  const toCheck = tool.toHand && bits.every((bit) => bit.have === undefined);
  const said = tool.toHand
    ? toCheck
      ? `Check your set has ${plural ? "both" : "it"}`
      : "Not in your set"
    : undefined;
  return (
    <li className="flex items-start gap-3 border-b border-border py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-interface font-bold text-foreground">
          {tool.name}
          {bits.length > 0 && `: ${bitSizes(bits)}`}
        </p>
        {said === undefined ? (
          <p className="text-meta text-muted-foreground">{stepsLine(tool)}</p>
        ) : (
          <p className="text-meta text-warning">{said}</p>
        )}
        {bits.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={help}
              onClick={() => setHelp((open) => !open)}
              className="self-start text-meta font-semibold text-primary-text"
            >
              How do I tell a bit's size?
            </button>
            {help && <p className="text-meta text-foreground/90">{BIT_SIZE_HELP}</p>}
          </>
        )}
      </div>
      <div className="flex w-32 shrink-0 flex-col items-stretch gap-2">
        <Button variant="outline" size="md" onClick={() => props.have(tool, bits)}>
          {plural ? "Have them" : "Have it"}
        </Button>
        {props.buying ? (
          <p className="text-center text-meta text-muted-foreground">On the buy list</p>
        ) : (
          // A bit missing from a set the owner has is bought at the shop, not as a tool.
          !tool.toHand && (
            <Button variant="soft" size="md" onClick={() => props.buy(tool.tool)}>
              Add to list
            </Button>
          )
        )}
      </div>
    </li>
  );
}

/**
 * The tools the steps need against what's to hand (#698), said once (#763; Paper, 2 · Agreed,
 * "Fabrication · Tools and warnings · Fold"): the ones to sort first, each with what to do (Have
 * it, saved to Your tools, or Add to list, onto this Build's buy list), then what's to hand, a
 * stand-in with what will do ("Your step stool will do").
 */
export function ToolsList(props: {
  derived: DerivedBuild;
  build: string;
  progress: Progress;
  reread: () => void;
}) {
  const tools = toolsNeeded(props.derived);
  const sorting = tools.filter(toSort);
  const toHand = tools.filter((tool) => !toSort(tool));
  const [saved, setSaved] = useState<{ name: string; change: ChangeId }>();
  const [problem, setProblem] = useState<string>();

  const have = async (tool: ToolNeeded, bits: ToolNeeded["bits"]) => {
    const read = await yourTools();
    if (read.kind !== "loaded") {
      setProblem("Your tools couldn't be read just now. Try again in a moment.");
      return;
    }
    const sizes = bits.map((bit) => bit.mm);
    const done = await saveTools(withHad(read.data, tool.name, sizes));
    if (done.kind !== "loaded") {
      setProblem("It couldn't be saved just now. Try again in a moment.");
      return;
    }
    setProblem(undefined);
    if (done.data.change !== null) setSaved({ name: tool.name, change: done.data.change });
    props.reread();
  };
  const undo = async () => {
    if (saved === undefined) return;
    const undone = await undoTools(saved.change);
    setSaved(undefined);
    if (undone.kind !== "loaded") setProblem("It couldn't be undone just now.");
    props.reread();
  };

  return (
    <section aria-label="Tools" className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-col gap-1">
          <h2 className="display-title text-sheet-title">
            {sorting.length === 0 ? `All ${tools.length} to hand` : `${sorting.length} to sort`}
          </h2>
          {sorting.length > 0 && (
            <p className="text-meta text-muted-foreground">Everything else is to hand.</p>
          )}
        </div>
        {/* The owner's tools, ticked on Your tools (#707), for any Build. */}
        <Link
          to="/tools"
          search={{ back: props.build }}
          className={buttonLook({ variant: "quietPrimary", size: "xs" })}
        >
          Your tools
        </Link>
      </div>
      {saved !== undefined && (
        <p role="status" className="flex items-center gap-2 py-2 text-meta text-success">
          {saved.name} saved to Your tools
          <Button variant="quiet" size="xs" onClick={undo}>
            Undo
          </Button>
        </p>
      )}
      {problem !== undefined && (
        <p role="alert" className="py-2 text-meta text-warning">
          {problem}
        </p>
      )}
      {sorting.length > 0 && (
        <ul aria-label="To sort" className="flex flex-col">
          {sorting.map((tool) => (
            <ToSort
              key={tool.tool}
              tool={tool}
              buying={props.progress.progress.buying.includes(tool.tool)}
              have={have}
              buy={props.progress.buy}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 pt-3">
        <CapsLabel tone="muted">To hand · {toHand.length}</CapsLabel>
        <ul aria-label="To hand" className="flex flex-col">
          {toHand
            .filter((tool) => tool.standIn !== undefined)
            .map((tool) => (
              <li key={tool.tool} className="flex items-start gap-3 border-b border-border py-2.5">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-interface font-semibold text-foreground">{tool.name}</span>
                  <span className="text-meta text-success">
                    Your {tool.standIn?.toLowerCase()} will do
                  </span>
                </span>
              </li>
            ))}
        </ul>
        <ul aria-label="Also to hand" className="flex flex-wrap gap-2 pt-1">
          {toHand
            .filter((tool) => tool.standIn === undefined)
            .map((tool) => (
              <li
                key={tool.tool}
                className="flex h-9 items-center rounded-full bg-muted px-4 text-meta font-semibold text-foreground"
              >
                {tool.name}
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
