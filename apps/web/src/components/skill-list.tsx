import {
  SKILL_SOURCE_NAMES,
  type SkillName,
  type SkillSummary,
  skillTitle,
  type UsableSkillSummary,
} from "@courtyard/contract";
import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * A workspace's skills as rows (ADR 0016): each one's name, what it's for (or why it can't be
 * used), and where it comes from in a column of its own, so sources line up down the list. The
 * same rows in the message box's skill picker, its sheet on a phone, and the workspace page's
 * Skills section. Not on the first load.
 */

const SIZES = {
  /** The message box's floating list. */
  menu: {
    row: "gap-3 px-3.5 py-2",
    name: "text-sm/5",
    about: "text-xs/[18px]",
    source: "w-33 text-xs/5",
  },
  /** A phone's sheet, and the workspace page on a phone; the page's own look from tablet width. */
  page: {
    row: "gap-3 py-2.75 md:gap-4 md:py-3",
    name: "text-base/[22px] md:text-base/6",
    about: "text-sm/5",
    source: "w-23 pt-0.5 text-xs/[18px] md:w-40 md:pt-0 md:text-xs/6",
  },
} as const;

/** Whether the skill can be picked: it can be used here. */
export const usable = (skill: SkillSummary): skill is UsableSkillSummary => skill.kind === "usable";

/**
 * Whether the skill picker lists the skill: every one but Matt Pocock's that the model loads
 * itself (ADR 0023), and each that can't be used, greyed, saying why.
 */
export const inPicker = (skill: SkillSummary) => skill.kind === "unusable" || skill.inPicker;

/** A skill's name as a row shows it: a broken one by its folder's name, as it is. */
const nameOf = (skill: SkillSummary) =>
  skill.kind === "unusable" && skill.problem.kind === "broken"
    ? skill.name
    : skillTitle(skill.name);

/** Text ending in a full stop, so more can follow it. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** What a row says under the name: what the skill is for, or why it can't be used. */
function About(props: { skill: SkillSummary; more: boolean; className: string }) {
  const { skill } = props;
  if (skill.kind === "unusable") {
    return skill.problem.kind === "broken" ? (
      <span className={classes("text-destructive-text", props.className)}>
        Can't be used: {skill.problem.reason}
      </span>
    ) : (
      <span className={classes("text-muted-foreground", props.className)}>
        Needs a code workspace: it runs a script
      </span>
    );
  }
  const extras = props.more
    ? [
        ...(skill.replacesHouse ? [`Replaces the house ${skillTitle(skill.name)} here.`] : []),
        ...(skill.ownerOnly ? ["Only you start it."] : []),
      ]
    : [];
  const text = extras.length === 0 ? skill.description : [sentence(skill.description), ...extras];
  return (
    <span className={classes("text-muted-foreground", props.className)}>
      {typeof text === "string" ? text : text.join(" ")}
    </span>
  );
}

/** One skill's row, inside whatever makes it pickable (an option, a button) or not. */
export function SkillRow(props: {
  skill: SkillSummary;
  size: keyof typeof SIZES;
  /** Says when it replaces a house skill or only the owner starts it (the workspace page). */
  more?: boolean;
}) {
  const { skill } = props;
  const size = SIZES[props.size];
  const greyed = !usable(skill);
  return (
    <span className={classes("flex w-full items-start text-left", size.row)}>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span
          className={classes(
            "font-medium wrap-anywhere",
            size.name,
            greyed ? "text-placeholder" : "text-foreground",
          )}
        >
          {nameOf(skill)}
        </span>
        <About skill={skill} more={props.more === true} className={size.about} />
      </span>
      <span
        className={classes(
          "flex shrink-0 flex-wrap justify-end text-right",
          size.source,
          greyed ? "text-placeholder" : "text-muted-foreground",
        )}
      >
        {SKILL_SOURCE_NAMES[skill.source]}
      </span>
    </span>
  );
}

/** A workspace's skills, as a plain list (the Skills section): usable ones first, as given. */
export function SkillList(props: { skills: readonly SkillSummary[]; label: string }) {
  return (
    <ul aria-label={props.label} className="flex flex-col">
      {props.skills.map((skill) => (
        <li key={`${skill.source}:${skill.name}`} className="border-b last:border-b-0">
          <SkillRow skill={skill} size="page" more />
        </li>
      ))}
    </ul>
  );
}

/**
 * A workspace's skills to pick one from (a phone's "Use a skill" sheet): each usable one a button,
 * the rest greyed and not pickable, after a line.
 */
export function SkillChoices(props: {
  skills: readonly SkillSummary[];
  pick: (name: SkillName) => void;
}): ReactNode {
  return (
    <ul aria-label="Skills" className="flex flex-col">
      {props.skills.map((skill) => (
        <li key={`${skill.source}:${skill.name}`} className="border-b last:border-b-0">
          <button
            type="button"
            disabled={!usable(skill)}
            onClick={() => usable(skill) && props.pick(skill.name)}
            className="-mx-2 flex w-[calc(100%+1rem)] rounded-md px-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:hover:bg-transparent"
          >
            <SkillRow skill={skill} size="page" />
          </button>
        </li>
      ))}
    </ul>
  );
}
