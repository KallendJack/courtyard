import type { BuildPart, BuildStep } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Drawing } from "../close-up.tsx";

// A step's close-up beside its model at the bench (#826; Paper, 2 · Agreed, "Fabrication · End
// frames in 3D, your kit · Fold (#785, #788)"): a card at the board's size, its title, its drawing,
// and what its screw spots or mark ask, never left to guess: by eye or measured, and whether to
// drill first. Its notes are behind Show me how.

type BuildCloseUp = BuildStep["closeUps"][number];
type Answers = NonNullable<BuildCloseUp["answers"]>;

/** One answer: its pill, and a few words under it. */
function Answer(props: { says: string; under: string; tone: string }) {
  return (
    <li className="flex flex-col items-center gap-0.5">
      <span
        className={classes(
          "rounded-full border border-input bg-secondary px-2.5 py-0.5 text-label font-bold whitespace-nowrap",
          props.tone,
        )}
      >
        {props.says}
      </span>
      <span className="text-caption whitespace-nowrap text-muted-foreground">{props.under}</span>
    </li>
  );
}

/** By eye or Measure, and Drill first or Just screw, as the board's pills. */
function AnswerPills(props: { answers: Answers }) {
  const { placed, mm, drill } = props.answers;
  return (
    <ul aria-label="How" className="flex shrink-0 flex-col justify-center gap-2">
      {placed === "eye" ? (
        <Answer says="By eye" under="in the green" tone="text-yours" />
      ) : (
        <Answer
          says="Measure"
          under={mm === undefined ? "with your tape" : `${mm}`}
          tone="text-yours"
        />
      )}
      {drill !== undefined &&
        (drill.first ? (
          <Answer
            says="Drill first"
            under={drill.bit === undefined ? "a pilot hole" : `${drill.bit} mm bit`}
            tone="text-warning"
          />
        ) : (
          <Answer says="Just screw" under="straight in" tone="text-success" />
        ))}
    </ul>
  );
}

export function CloseUpCard(props: { closeUp: BuildCloseUp; parts: readonly BuildPart[] }) {
  const { closeUp } = props;
  return (
    <section
      aria-label={`Close-up · ${closeUp.title}`}
      className="flex min-h-0 min-w-0 flex-col gap-1 rounded-row border border-border bg-surface p-2.5"
    >
      <CapsLabel tone="muted" heading={{ level: 3 }} className="truncate">
        {closeUp.title}
      </CapsLabel>
      <div className="flex min-h-0 flex-1 items-stretch gap-2">
        <div className="min-h-0 min-w-0 flex-1">
          <Drawing closeUp={closeUp} parts={props.parts} bare />
        </div>
        {closeUp.answers !== undefined && <AnswerPills answers={closeUp.answers} />}
      </div>
    </section>
  );
}
