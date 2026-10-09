import type { SkillSummary } from "@courtyard/contract";
import { classes } from "@/lib/classes";
import { SkillRow, usable } from "./skill-list.tsx";

/**
 * The skills a message box offers, floating above it (ADR 0016): every skill the workspace gets,
 * usable ones first, then the rest greyed after a line, saying why. A listbox the box drives from
 * the keyboard: `active` is the highlighted usable skill, picked with Enter or a click. Not on the
 * first load.
 */
export function SkillMenu(props: {
  id: string;
  /** The workspace's name, for the list's heading. */
  workspaceName: string;
  skills: readonly SkillSummary[];
  /** The highlighted skill's name, if any. */
  active: string | undefined;
  pick: (name: string) => void;
  /** Where it floats: above the box, or below it when there's no room above; and how tall it may be. */
  place: { readonly side: "above" | "below"; readonly maxHeight: number };
}) {
  const firstUnusable = props.skills.findIndex((skill) => !usable(skill));
  return (
    <div
      style={{ maxHeight: props.place.maxHeight }}
      className={classes(
        "absolute inset-x-0 z-10 flex w-full max-w-120 flex-col overflow-y-auto rounded-md border bg-field py-1.5 shadow-lg shadow-foreground/8",
        props.place.side === "above" ? "bottom-full mb-2" : "top-full mt-2",
      )}
    >
      <p
        id={`${props.id}-heading`}
        className="px-3.5 pt-1.5 pb-2 text-xs/4 font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        Skills in {props.workspaceName}
      </p>
      {props.skills.length === 0 ? (
        <p className="px-3.5 pb-2 text-xs text-muted-foreground">No skill matches.</p>
      ) : (
        <div id={props.id} role="listbox" aria-labelledby={`${props.id}-heading`}>
          {props.skills.map((skill, index) => {
            const pickable = usable(skill);
            const active = pickable && skill.name === props.active;
            return (
              // The box keeps the keyboard; a click picks without taking focus from it.
              // biome-ignore lint/a11y/useKeyWithClickEvents: the message box handles the keys
              <div
                key={`${skill.source}:${skill.name}`}
                id={skillOptionId(props.id, skill.name)}
                role="option"
                tabIndex={-1}
                aria-selected={active}
                aria-disabled={!pickable}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickable && props.pick(skill.name)}
                className={classes(
                  pickable && "cursor-pointer hover:bg-accent/60",
                  active && "bg-accent",
                  index === firstUnusable && index > 0 && "mt-1 border-t pt-1",
                )}
              >
                <SkillRow skill={skill} size="menu" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The option element's id for a skill in the menu, for the box's `aria-activedescendant`. */
export const skillOptionId = (menuId: string, name: string) => `${menuId}-${name}`;

/**
 * The skills whose name or description has `query` in it, ignoring case: what typing after `/`
 * narrows the list to.
 */
export const matchingSkills = (skills: readonly SkillSummary[], query: string) => {
  const wanted = query.trim().toLowerCase();
  return wanted === ""
    ? skills
    : skills.filter((skill) =>
        [skill.name, skill.name.replaceAll("-", " "), skill.description].some((text) =>
          text.toLowerCase().includes(wanted),
        ),
      );
};
