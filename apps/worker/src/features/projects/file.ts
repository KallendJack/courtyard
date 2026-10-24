import { ProjectDecision, ProjectFields, ProjectStep, StepKind } from "@courtyard/contract";
import { err, ok, type Result } from "../../lib/result.ts";

// A project's file as written (#603): its name, goal and status between --- lines, then its steps,
// its decisions and a dated history, each under its heading.

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
const STEP_LINE = /^[-*][ \t]+\[([^\]]+)\][ \t]*(.*)$/;
const HISTORY_LINE = /^(?:[-*][ \t]+)?(?:(\d{4}-\d{2}-\d{2}):[ \t]*)?(.*)$/;
const DECISION_LINE = /^[-*][ \t]+(pick|why|options):[ \t]*(.*)$/i;
/** At the end of a step that makes a Build (#697): `[build: workbench]`. */
const BUILD_MARK = /[ \t]+\[build:[ \t]*([^\]]*)\]$/;
/** Between a step's words and its detail, as its file writes it. */
export const DETAIL = " · ";

/**
 * A step as its file writes it: `- [needs a pro] Sockets by the desk · an electrician`, or one that
 * makes a Build, `- [you can do this] Build the workbench · a weekend [build: workbench]`.
 */
const stepLine = ({ kind, text, detail, build }: ProjectStep) =>
  `- [${kind}] ${text}${detail === undefined ? "" : `${DETAIL}${detail}`}${build === undefined ? "" : ` [build: ${build}]`}`;

/** A project's file read, or what's wrong with it. */
export const readProjectText = (text: string): Result<ProjectFile, string> => {
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
  const steps: ProjectStep[] = [];
  const decisions: ProjectDecision[] = [];
  const history: ProjectHistoryLine[] = [];
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
      const [, kind = "", line = ""] = STEP_LINE.exec(said) ?? [];
      const build = BUILD_MARK.exec(line)?.[1]?.trim();
      const rest = line.replace(BUILD_MARK, "");
      const at = rest.indexOf(DETAIL);
      const step = ProjectStep.safeParse({
        kind: StepKind.safeParse(kind.trim().toLowerCase()).data,
        text: at === -1 ? rest : rest.slice(0, at),
        ...(at === -1 ? {} : { detail: rest.slice(at + DETAIL.length) }),
        ...(build === undefined ? {} : { build }),
      });
      if (!step.success) {
        return err(
          `A step isn't "- [you can do this]", "- [needs a pro]" or "- [decided]" and its words: "${said}".`,
        );
      }
      steps.push(step.data);
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
  return ok({ fields: fields.data, steps, decisions, history });
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
