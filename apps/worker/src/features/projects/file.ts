import {
  BuildSlug,
  ProjectDecision,
  ProjectFields,
  ProjectStep,
  StepId,
  StepNeed,
  StepWho,
} from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";

// A project's file as written (#603): its name, goal and status between --- lines, then its steps,
// its decisions and a dated history, each under its heading. A step (#710) is a task line, its
// words and detail, then its marks: `- [ ] Fix shelving · an hour [id: s4] [who: you] [needs: the
// wall's construction]`, done `- [x] … [done: 2026-10-23]`.

/** One line of a project's history: its date (`2026-10-20`), when it has one, and what happened. */
export type ProjectHistoryLine = { readonly date: string | null; readonly text: string };

/** A project's file, read: its fields, steps, decisions and history, oldest first. */
export type ProjectFile = {
  readonly fields: ProjectFields;
  readonly steps: readonly ProjectStep[];
  readonly decisions: readonly ProjectDecision[];
  readonly history: readonly ProjectHistoryLine[];
};

const FRONT_KEYS = ["name", "goal", "status"] as const;
const SECTIONS = { steps: "Steps", decisions: "Decisions", history: "History" } as const;
const SECTION_KEYS = ["steps", "decisions", "history"] as const;
/** A step as written now (#710): `- [ ]` or `- [x]`, then its words and marks. */
const TASK_LINE = /^[-*][ \t]+\[([ xX])\][ \t]+(.*)$/;
/** A step as written before #710: its kind in brackets, then its words. */
const KIND_LINE = /^[-*][ \t]+\[(you can do this|needs a pro|decided)\][ \t]*(.*)$/i;
const HISTORY_LINE = /^(?:[-*][ \t]+)?(?:(\d{4}-\d{2}-\d{2}):[ \t]*)?(.*)$/;
const DECISION_LINE = /^[-*][ \t]+(pick|why|options):[ \t]*(.*)$/i;
/** A mark at the end of a step's line: `[build: workbench]`, `[needs: the wall's height = 2.4 m]`. */
const MARK = /[ \t]+\[(id|who|needs|build|done):[ \t]*([^\]]*)\]$/i;
/** Between a step's words and its detail, as its file writes it. */
export const DETAIL = " · ";
/** Between a need and what was found, in its mark. */
const KNOWN = " = ";

/** Who a step from before #710 is for, by its kind. */
const WHO_OF_KIND: Readonly<Record<string, StepWho>> = {
  "you can do this": "you",
  "needs a pro": "a pro",
};

/**
 * A step as its file writes it: `- [ ] Sockets by the desk · an electrician [id: s2] [who: a pro]`,
 * or one that makes a Build, `- [ ] Build the workbench · a weekend [id: s3] [who: you] [build:
 * workbench]`.
 */
const stepLine = ({ id, text, detail, who, done, doneOn, needs, build }: ProjectStep) =>
  [
    `- [${done ? "x" : " "}] ${text}${detail === undefined ? "" : `${DETAIL}${detail}`}`,
    `[id: ${id}]`,
    `[who: ${who}]`,
    ...needs.map(
      ({ what, known }) => `[needs: ${what}${known === undefined ? "" : `${KNOWN}${known}`}]`,
    ),
    ...(build === undefined ? [] : [`[build: ${build}]`]),
    ...(doneOn === undefined ? [] : [`[done: ${doneOn}]`]),
  ].join(" ");

/** A step's line, read before it has its ID. */
type StepRead = Omit<ProjectStep, "id"> & { id: StepId | undefined };

/**
 * One step's line, read: its words, detail and marks. A mark mistyped by hand loses only itself,
 * saying why; `undefined` for a decided step from before #710, whose decision holds it.
 */
const readStepLine = (
  said: string,
  problem: (text: string) => void,
): Result<StepRead | undefined, string> => {
  const task = TASK_LINE.exec(said);
  const kind = task === null ? KIND_LINE.exec(said) : null;
  if (task === null && kind === null) {
    return err(`A step isn't "- [ ]" or "- [x]" and its words: "${said}".`);
  }
  if (kind?.[1]?.toLowerCase() === "decided") return ok(undefined);
  let rest = task?.[2] ?? kind?.[2] ?? "";
  const marks: [string, string][] = [];
  for (let mark = MARK.exec(rest); mark !== null; mark = MARK.exec(rest)) {
    marks.unshift([mark[1]?.toLowerCase() ?? "", mark[2]?.trim() ?? ""]);
    rest = rest.slice(0, mark.index);
  }
  const at = rest.indexOf(DETAIL);
  const text = (at === -1 ? rest : rest.slice(0, at)).trim();
  const step: StepRead = {
    id: undefined,
    text,
    ...(at === -1 ? {} : { detail: rest.slice(at + DETAIL.length).trim() }),
    who: WHO_OF_KIND[kind?.[1]?.toLowerCase() ?? ""] ?? "you",
    done: task?.[1]?.toLowerCase() === "x",
    needs: [],
  };
  const named = `"${text}"`;
  for (const [key, value] of marks) {
    if (key === "id") {
      const id = StepId.safeParse(value);
      if (id.success) step.id = id.data;
      else
        problem(`Step ${named}'s ID "[id: ${value}]" isn't s and a number, so it's given another.`);
    } else if (key === "who") {
      const who = StepWho.safeParse(value.toLowerCase());
      if (who.success) step.who = who.data;
      else
        problem(
          `Step ${named}'s "[who: ${value}]" isn't you, a pro or courtyard, so it's read as you.`,
        );
    } else if (key === "needs") {
      const split = value.indexOf(KNOWN);
      const need = StepNeed.safeParse(
        split === -1
          ? { what: value }
          : { what: value.slice(0, split), known: value.slice(split + KNOWN.length) },
      );
      if (need.success) step.needs.push(need.data);
      else problem(`Step ${named}'s "[needs: ${value}]" can't be read, so it's left off.`);
    } else if (key === "build") {
      const build = BuildSlug.safeParse(value);
      if (build.success) step.build = build.data;
      else {
        problem(
          `Step ${named}'s Build link "[build: ${value}]" isn't a Build's file name (lowercase letters, digits and dashes), so the step is read without it.`,
        );
      }
    } else {
      const on = z.iso.date().safeParse(value);
      if (on.success) step.doneOn = on.data;
      else problem(`Step ${named}'s "[done: ${value}]" isn't a date, so it's left off.`);
    }
  }
  return ok(step);
};

/** The steps read, each given an ID: those without one (or with one taken) the next free number. */
const withIds = (steps: readonly StepRead[]) => {
  const taken = new Set<string>();
  let most = Math.max(0, ...steps.map(({ id }) => Number(id?.slice(1) ?? 0)));
  return steps.map((step) => {
    const id = step.id !== undefined && !taken.has(step.id) ? step.id : StepId.parse(`s${++most}`);
    taken.add(id);
    return { ...step, id };
  });
};

/**
 * A project's file read, and what in it was read without (a step's mark mistyped by hand, such as
 * a Build link that isn't a Build's file name, #697), or what's wrong with it.
 */
export const readProjectText = (
  text: string,
): Result<ProjectFile & { readonly problems: readonly string[] }, string> => {
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    return err("It doesn't start with its name and status between --- lines.");
  }
  const raw: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const [, key = "", value = ""] = /^([^:]+):(.*)$/.exec(line) ?? [];
    const field = FRONT_KEYS.find((name) => name === key.trim().toLowerCase());
    if (field === undefined) return err(`It has a line Courtyard doesn't know: "${line.trim()}".`);
    const unquoted = value.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (unquoted !== "") raw[field] = unquoted;
  }
  const fields = ProjectFields.safeParse(raw);
  if (!fields.success) {
    const [issue] = fields.error.issues;
    const name = String(issue?.path[0] ?? "a field");
    return err(
      raw[name] === undefined
        ? `It has no ${name}.`
        : name === "status"
          ? "Its status isn't active or done."
          : `Its ${name} doesn't fit: ${issue?.message ?? "it can't be read"}`,
    );
  }
  const steps: StepRead[] = [];
  const decisions: ProjectDecision[] = [];
  const history: ProjectHistoryLine[] = [];
  const problems: string[] = [];
  let section: keyof typeof SECTIONS | undefined;
  let decision: Record<string, unknown> | undefined;
  const endDecision = (): string | undefined => {
    if (decision === undefined) return undefined;
    const read = ProjectDecision.safeParse(decision);
    decision = undefined;
    if (!read.success) return `A decision doesn't fit: ${read.error.issues[0]?.message ?? ""}`;
    decisions.push(read.data);
    return undefined;
  };
  for (const line of lines.slice(end + 1)) {
    const said = line.trim();
    if (said === "") continue;
    const heading = /^##[ \t]+(.+)$/.exec(said);
    if (heading !== null) {
      const ended = endDecision();
      if (ended !== undefined) return err(ended);
      section = SECTION_KEYS.find(
        (key) => SECTIONS[key].toLowerCase() === heading[1]?.trim().toLowerCase(),
      );
      if (section === undefined) return err(`It has a section Courtyard doesn't know: "${said}".`);
      continue;
    }
    if (section === "steps") {
      const step = readStepLine(said, (problem) => problems.push(problem));
      if (!step.ok) return step;
      if (step.value !== undefined) steps.push(step.value);
    } else if (section === "decisions") {
      const about = /^###[ \t]+(.+)$/.exec(said);
      if (about !== null) {
        const ended = endDecision();
        if (ended !== undefined) return err(ended);
        decision = { about: about[1], options: [] };
        continue;
      }
      const [, key = "", value = ""] = DECISION_LINE.exec(said) ?? [];
      if (decision === undefined || key === "") {
        return err(`A decision's line isn't its pick, why or options: "${said}".`);
      }
      decision[key.toLowerCase()] =
        key.toLowerCase() === "options"
          ? value
              .split(";")
              .map((option) => option.trim())
              .filter((option) => option !== "")
          : value.trim();
    } else if (section === "history") {
      const [, date, text = ""] = HISTORY_LINE.exec(said) ?? [];
      history.push({ date: date ?? null, text: text.trim() });
    } else {
      return err(`It has words before its first section: "${said}".`);
    }
  }
  const ended = endDecision();
  if (ended !== undefined) return err(ended);
  const checked: ProjectStep[] = [];
  for (const step of withIds(steps)) {
    const read = ProjectStep.safeParse(step);
    if (!read.success) {
      return err(`A step doesn't fit: ${read.error.issues[0]?.message ?? ""} ("${step.text}")`);
    }
    checked.push(read.data);
  }
  return ok({ fields: fields.data, steps: checked, decisions, history, problems });
};

/** A project's file, written from its parts. */
export const projectText = (project: ProjectFile) => {
  const { fields, steps, decisions, history } = project;
  const front = FRONT_KEYS.flatMap((key) => {
    const value = fields[key];
    return value === undefined ? [] : [`${key}: ${value}`];
  });
  const sections = [
    ...(steps.length === 0 ? [] : [`## ${SECTIONS.steps}\n\n${steps.map(stepLine).join("\n")}`]),
    ...(decisions.length === 0
      ? []
      : [
          `## ${SECTIONS.decisions}\n\n${decisions
            .map(({ about, pick, why, options }) =>
              [
                `### ${about}`,
                "",
                `- Pick: ${pick}`,
                ...(why === undefined ? [] : [`- Why: ${why}`]),
                ...(options.length === 0 ? [] : [`- Options: ${options.join("; ")}`]),
              ].join("\n"),
            )
            .join("\n\n")}`,
        ]),
    ...(history.length === 0
      ? []
      : [
          `## ${SECTIONS.history}\n\n${history
            .map(({ date, text }) => `- ${date === null ? "" : `${date}: `}${text}`)
            .join("\n")}`,
        ]),
  ];
  return `---\n${front.join("\n")}\n---\n${sections.map((section) => `\n${section}\n`).join("")}`;
};
