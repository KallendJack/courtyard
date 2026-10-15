import type { ContextSection } from "@courtyard/contract";
import type { ReactNode } from "react";

/**
 * One section of a context file or the owner context: its lines, or a note that there are none.
 * `line` shows each line, when it's more than its text (a plan with Grill this plan).
 */
export function ContextLines(props: {
  title: string;
  hint: string;
  lines: readonly string[];
  line?: ((line: string) => ReactNode) | undefined;
}) {
  return (
    <section aria-label={props.title}>
      <h3 className="flex items-baseline gap-2 font-semibold">
        {props.title}{" "}
        <span className="text-meta font-normal text-muted-foreground">{props.hint}</span>
      </h3>
      {props.lines.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-primary-text">
          {props.lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity here
            <li key={`${index}-${line}`}>{props.line ? props.line(line) : line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Facts, Plans and Ideas, each with what it means; `line` shows each line, when it's more than its
 * text (a plan with Grill this plan, any line with Fix).
 */
export function FactsPlansIdeas(props: {
  facts: readonly string[];
  plans: readonly string[];
  ideas: readonly string[];
  line?: (line: string, section: ContextSection) => ReactNode;
}) {
  const { line } = props;
  const shown = (section: ContextSection) =>
    line === undefined ? undefined : (text: string) => line(text, section);
  return (
    <>
      <ContextLines title="Facts" hint="True now" lines={props.facts} line={shown("facts")} />
      <ContextLines
        title="Plans"
        hint="Decided, not done"
        lines={props.plans}
        line={shown("plans")}
      />
      <ContextLines
        title="Ideas"
        hint="Being considered"
        lines={props.ideas}
        line={shown("ideas")}
      />
    </>
  );
}
