import { ProjectStep, type StepId, type StepNeed } from "@courtyard/contract";
import { err, ok, type Result } from "../../lib/result.ts";
import type { ProjectEdit, ProjectHistoryLine, ProjectRefusal } from "./index.ts";

// A project's steps changed (#710, ADR 0037): one step by its ID (its words, who, needs, Build,
// done, place), then the steps added, before a step or after the rest. IDs are given here, the
// next number up, so a step keeps its ID through a reorder and a rename.

/** A step as a note names it: its words, who does it, and its Build. */
export const stepWords = ({ who, text, build }: ProjectStep) =>
  `${text} (${who}${build === undefined ? "" : `, Build: ${build}`})`;

/** The steps after an edit, what changed for its note, and lines for its history. */
type StepsEdited = {
  readonly steps: ProjectStep[];
  readonly changes: string[];
  readonly history: ProjectHistoryLine[];
};

const invalid = (issues: readonly { message: string }[]): ProjectRefusal => ({
  kind: "invalid",
  problem: issues[0]?.message ?? "",
});

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A need's words to the need it is, keeping what was found for one it had already. */
const needsFrom = (said: readonly string[], had: readonly StepNeed[]) =>
  said.map((what) => had.find((need) => same(need.what, what)) ?? { what });

/** The project's steps with `edit`'s step and steps added applied, or why not. */
export const editSteps = (
  was: readonly ProjectStep[],
  edit: Pick<ProjectEdit, "step" | "addSteps" | "addBefore">,
  today: string,
): Result<StepsEdited, ProjectRefusal> => {
  const steps = [...was];
  const changes: string[] = [];
  const history: ProjectHistoryLine[] = [];
  const at = (id: string) => steps.findIndex((step) => same(step.id, id));
  const noSuch = (id: string): ProjectRefusal => ({
    kind: "no-such-step",
    id,
    ids: steps.map((step) => step.id),
  });

  const { step } = edit;
  if (step !== undefined) {
    const index = at(step.id);
    const there = steps[index];
    if (there === undefined) return err(noSuch(step.id));
    if (step.remove) {
      steps.splice(index, 1);
      changes.push(`Removed step: ${there.text}`);
    } else {
      const needs = needsFrom(step.needs ?? there.needs.map(({ what }) => what), there.needs);
      if (step.known !== undefined) {
        const { need, known } = step.known;
        const which = needs.findIndex((one) => same(one.what, need));
        if (which === -1) {
          return err({ kind: "no-such-need", need, needs: needs.map(({ what }) => what) });
        }
        needs[which] = { what: needs[which]?.what ?? need, known };
        changes.push(`Known: ${needs[which]?.what}: ${known}`);
      }
      const done = step.done ?? there.done;
      const detail = step.detail === null ? undefined : (step.detail ?? there.detail);
      const build = step.build === null ? undefined : (step.build ?? there.build);
      const doneOn = !done ? undefined : there.done ? there.doneOn : today;
      const changed = ProjectStep.safeParse({
        id: there.id,
        text: step.text ?? there.text,
        ...(detail === undefined ? {} : { detail }),
        who: step.who ?? there.who,
        done,
        ...(doneOn === undefined ? {} : { doneOn }),
        needs,
        ...(build === undefined ? {} : { build }),
      });
      if (!changed.success) return err(invalid(changed.error.issues));
      steps[index] = changed.data;
      if (done !== there.done) {
        const line = `${done ? "Done" : "Not done"}: ${changed.data.text}`;
        changes.push(line);
        history.push({ date: today, text: line });
      } else if (Object.keys(step).some((key) => !["id", "known", "before"].includes(key))) {
        changes.push(`Step: ${stepWords(changed.data)}`);
      }
      if (step.before !== undefined) {
        const [moved] = steps.splice(index, 1);
        const to = step.before === null ? steps.length : at(step.before);
        if (moved === undefined || to === -1) return err(noSuch(step.before ?? ""));
        steps.splice(to, 0, moved);
        changes.push(`Moved: ${moved.text}`);
      }
    }
  }

  const added: ProjectStep[] = [];
  let most = Math.max(0, ...was.map(({ id }) => Number(id.slice(1))));
  for (const { needs, ...one } of edit.addSteps ?? []) {
    const checked = ProjectStep.safeParse({
      ...one,
      id: `s${++most}`,
      done: false,
      needs: (needs ?? []).map((what) => ({ what })),
    });
    if (!checked.success) return err(invalid(checked.error.issues));
    added.push(checked.data);
    changes.push(`Step: ${stepWords(checked.data)}`);
  }
  const before = edit.addBefore === undefined ? steps.length : at(edit.addBefore);
  if (before === -1) return err(noSuch(edit.addBefore ?? ""));
  steps.splice(before, 0, ...added);
  return ok({ steps, changes, history });
};

/** The IDs as a refusal lists them: "s1, s2 and s3". */
export const idList = (ids: readonly StepId[]) =>
  ids.length <= 1 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
