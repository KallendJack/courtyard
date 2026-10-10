import type { SkillIcon, SkillName, SkillSummary } from "@courtyard/contract";
import { Book, Flame, UserRound } from "lucide-react";
import { useId } from "react";
import { classes } from "@/lib/classes";
import { CapsLabel } from "./caps-label.tsx";
import { FrameButton } from "./frame-button.tsx";
import { nameOf, usable, whyUnusable } from "./skill-list.tsx";

/**
 * What a Handheld sheet (handheld-sheet.tsx, #194) offers to pick from: a workspace's skills, and
 * rows of tiles for the model and its effort (Paper board Handheld · 09). Their classes are in
 * handheld-frame.css, loaded with the frame, and apply inside their own roots only.
 */

/**
 * A skill's mark, as the skill gives it: the flame (Grilling, as Grill this plan has), a person
 * (Get to know), else the book every skill has elsewhere.
 */
function SkillMark(props: { icon: SkillIcon | undefined }) {
  if (props.icon === "flame") return <Flame aria-hidden strokeWidth={1.8} />;
  if (props.icon === "person") return <UserRound aria-hidden strokeWidth={1.6} />;
  return <Book aria-hidden strokeWidth={1.6} />;
}

/**
 * A workspace's skills to pick one from: each its mark, its name and one line of what it's for.
 * Those it can't use come last, greyed after a line, saying why.
 */
export function SheetSkills(props: {
  skills: readonly SkillSummary[];
  /** The skill the message already starts, if any. */
  picked: SkillName | undefined;
  pick: (name: SkillName) => void;
}) {
  const firstUnusable = props.skills.findIndex((skill) => !usable(skill));
  return (
    <div data-handheld="" className="contents">
      <ul aria-label="Skills" className="flex flex-col gap-1.5">
        {props.skills.map((skill, index) => {
          const why = skill.kind === "unusable" ? whyUnusable(skill) : undefined;
          const picked = skill.name === props.picked;
          return (
            <li
              key={`${skill.source}:${skill.name}`}
              className={classes(index === firstUnusable && index > 0 && "mt-1.5 border-t pt-3")}
            >
              <FrameButton
                look="choice"
                lit={picked}
                disabled={why !== undefined}
                aria-pressed={picked}
                onClick={() => usable(skill) && props.pick(skill.name)}
              >
                <SkillMark icon={skill.icon} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={classes(
                      "truncate text-[15px]/5 font-bold",
                      why === undefined ? "text-foreground" : "text-placeholder",
                    )}
                  >
                    {nameOf(skill)}
                  </span>
                  <span
                    className={classes(
                      "truncate text-[12px]/4",
                      why?.broken ? "text-destructive-text" : "text-muted-foreground",
                    )}
                  >
                    {why?.text ?? skill.description}
                  </span>
                </span>
              </FrameButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One choice of a few, as a segmented row of tiles under a label in capitals: each its name and a
 * word under it ("Sonnet 5", "Claude"), the chosen one lit. Radio buttons, so the keyboard and
 * screen readers treat it as one. Onto another row when there are more than fit.
 */
export function SheetChoices<T extends string>(props: {
  label: string;
  options: readonly { readonly value: T; readonly label: string; readonly word?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  const heading = useId();
  return (
    <div data-handheld="" className="contents">
      <div className="flex flex-col gap-2">
        <span className="px-1">
          <CapsLabel tone="muted" heading={{ id: heading }}>
            {props.label}
          </CapsLabel>
        </span>
        <div
          role="radiogroup"
          aria-labelledby={heading}
          className="flex flex-wrap gap-1.5 rounded-lg bg-background p-1"
        >
          {props.options.map((option) => {
            const chosen = option.value === props.value;
            return (
              <label
                key={option.value}
                className={classes(
                  "flex min-h-13 min-w-0 flex-[1_1_4.5rem] cursor-pointer flex-col items-center justify-center rounded-row px-2 py-1.5 text-center select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  chosen ? "bg-foreground text-card" : "text-foreground active:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={chosen}
                  onChange={() => props.onChange(option.value)}
                  className="sr-only"
                />
                <span
                  className={classes(
                    "max-w-full truncate text-sm/4.5",
                    chosen ? "font-extrabold" : "font-bold",
                  )}
                >
                  {option.label}
                </span>
                {option.word !== undefined && option.word !== "" && (
                  <span className="max-w-full truncate text-[11px]/3.5 font-semibold text-placeholder">
                    {option.word}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
