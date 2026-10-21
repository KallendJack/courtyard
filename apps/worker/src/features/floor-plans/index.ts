import { FloorPlan, type HomeSubject } from "@courtyard/contract";
import { ok, type Result } from "../../lib/result.ts";
import {
  type DocumentRefusal,
  type DocumentSaved,
  getDocument,
  listDocuments,
  putDocument,
} from "../documents/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";

/**
 * Floor plans Courtyard draws itself (#257): a model writes a room as data in a `plan` block, the
 * web app draws it, and the worker keeps each room's last plan as a document of its own
 * (ADR 0020), saved the moment its answer ends, which Home shows.
 */

/** A `plan` fenced block: its fence, then its JSON, then the same fence closing it. */
const PLAN_BLOCK = /^[ \t]*(`{3,}|~{3,})[ \t]*plan[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*$/gim;

/** A block's JSON as a plan Courtyard can draw, or `undefined`. */
const planFrom = (source: string) => {
  try {
    const parsed = FloorPlan.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** The plans in some Markdown that Courtyard can draw: the last drawn of each room, in order. */
export const plansIn = (markdown: string): FloorPlan[] => {
  const byRoom = new Map<string, FloorPlan>();
  for (const [, , source] of markdown.matchAll(PLAN_BLOCK)) {
    const plan = planFrom(source ?? "");
    if (plan === undefined) continue;
    const room = plan.room.toLowerCase();
    byRoom.delete(room);
    byRoom.set(room, plan);
  }
  return [...byRoom.values()];
};

/** A room's plan as its document: named after the room, holding only the plan's block. */
const planDocument = (plan: FloorPlan) =>
  `# ${plan.room} floor plan\n\n\`\`\`plan\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;

/**
 * Saves each room's plan in an answer as that room's document, one change each: a new one, or in
 * place of its last plan. A plan the same as the one saved saves nothing. What was saved, in order.
 */
export const savePlansFrom = async (
  target: PlanningFilesTarget,
  answer: string,
): Promise<DocumentSaved[]> => {
  const saved: DocumentSaved[] = [];
  for (const plan of plansIn(answer)) {
    const put = await putDocument(target, {
      markdown: planDocument(plan),
      title: (action) => `${action === "save" ? "Save" : "Update"} floor plan: ${plan.room}`,
    });
    // A code workspace keeps no documents (ADR 0026): its plans are drawn, never saved.
    if (!put.ok && put.error.kind === "code-workspace") return saved;
    if (!put.ok) console.error(`A floor plan of ${plan.room} couldn't be saved: ${put.error.kind}`);
    else if (put.value !== undefined) saved.push(put.value);
  }
  return saved;
};

/** Whether a document's text below its heading is one plan and nothing else. */
const onlyAPlan = (body: string) => body.replace(PLAN_BLOCK, "").trim() === "";

/** A room's floor plan as a Home's subject. */
type PlanSubject = Extract<HomeSubject, { kind: "plan" }>;

/**
 * Each document that is a room's plan and nothing else, newest first, whoever saved it: the
 * newest is a space's main subject on Home (#257, #603).
 */
export const planSubjects = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
): Promise<Result<PlanSubject[], DocumentRefusal>> => {
  const documents = await listDocuments(target);
  if (!documents.ok) return documents;
  const plans: { subject: PlanSubject; updatedAt: string }[] = [];
  for (const { slug, updatedAt } of documents.value) {
    const read = await getDocument(target, slug);
    if (!read.ok) continue;
    const [plan] = plansIn(read.value.body);
    if (plan === undefined || !onlyAPlan(read.value.body)) continue;
    plans.push({
      subject: { kind: "plan", name: `${plan.room} plan`, document: slug, plan },
      updatedAt,
    });
  }
  return ok(
    plans
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map(({ subject }) => subject),
  );
};
