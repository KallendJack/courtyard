import { join } from "node:path";
import {
  type BuildSlug,
  ObservedDay,
  type OldSize,
  type OldSizesConfirm,
  type OwnerSizeSource,
  type RecordSource,
  type SizeLine,
  type SizeRecord,
  type SpaceSizes,
  type SubjectId,
  type ThingSizes,
  type ThingSlug,
  type WorkspaceId,
} from "@courtyard/contract";
import { readTextFile } from "../../../lib/files.ts";
import { err, ok, type Result } from "../../../lib/result.ts";
import { parseContextFile } from "../../context-file/index.ts";
import { type PlanningFilesTarget, planningFolder } from "../../planning-files/index.ts";
import { readProjects, readProjectText } from "../../projects/index.ts";
import { historyDate, type ReadThing, readThingsIn } from "../../things/index.ts";
import { CONTEXT_FILE } from "../../workspaces/index.ts";
import {
  type ReadSize,
  readSizes,
  type SizeRefusal,
  sameName,
  sameValue,
  standing,
} from "./index.ts";
import { type OldSentence, oldSizesIn } from "./old-sizes.ts";
import { confirmedPath, type SizeEdit, saveSizes } from "./save.ts";

// A space's sizes in Fabrication (#709): the room's Things panel. Its records grouped into lines,
// one per size, with the sizes any space needs and those its Builds' steps need, each with where
// to measure it; the Things in it with sizes; and the old sizes written in sentences, offered
// once to confirm.

/** The sizes every space needs, with where to measure each: any room, van or shed. */
const SPACE_NEEDS: readonly { property: string; where: string }[] = [
  { property: "Inside width", where: "wall to wall, at the back, on the floor" },
  { property: "Inside length", where: "back wall to the door" },
  { property: "Floor to ceiling", where: "floor to the lowest point overhead" },
];

/** A need's words as a size's name: "the back wall's height" as "Back wall's height". */
const needName = (what: string) => {
  const name = what.trim().replace(/^the\s+/i, "");
  return `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
};

/** A size a space needs: its name, where to measure it, and the Builds whose steps need it. */
export type Needed = { property: string; where: string | null; builds: BuildSlug[] };

/**
 * A Thing's lines: one per size, those it needs first in order, then the rest as first recorded.
 * A line's records are its standing ones, one per value, so two only when they disagree; `was`
 * is what the record it corrected said, when that differs. The guided re-measure asks for a
 * needed size not measured yet, and for any whose records disagree.
 */
export const linesOf = (
  sizes: readonly ReadSize[],
  subject: SubjectId | undefined,
  needed: readonly Needed[],
): SizeLine[] => {
  const all = subject === undefined ? [] : sizes.filter(({ record }) => record.subject === subject);
  const groups = new Map<string, { property: string; records: SizeRecord[] }>();
  for (const { record } of all.filter(standing)) {
    const key = sameName(record.property);
    const group = groups.get(key) ?? { property: record.property, records: [] };
    // The newest record of each value stands for it, unless that hides one measured behind one said.
    const same = group.records.find((one) => sameValue(one.value, record.value));
    if (same?.source.kind !== "measured" || record.source.kind === "measured") {
      group.records = [...group.records.filter((one) => one !== same), record];
    }
    groups.set(key, group);
  }
  const lineOf = (property: string, need: Needed | undefined): SizeLine => {
    // Oldest first; those recorded at once (in one turn) by value, so they keep their places.
    const records = [...(groups.get(sameName(property))?.records ?? [])].sort(
      (a, b) =>
        a.recorded.localeCompare(b.recorded) ||
        JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)),
    );
    const [only] = records;
    const corrected =
      records.length === 1 && only !== undefined
        ? all.find(({ record }) => record.supersededBy === only.id)?.record
        : undefined;
    const was =
      corrected !== undefined &&
      only !== undefined &&
      (!sameValue(corrected.value, only.value) || corrected.source.kind !== only.source.kind)
        ? { value: corrected.value, source: corrected.source.kind }
        : null;
    const disagree = records.length > 1;
    const measured = records.some(({ source }) => source.kind === "measured");
    return {
      property: records[0]?.property ?? property,
      records,
      was,
      where: need?.where ?? null,
      builds: need?.builds ?? [],
      toMeasure: disagree || (need !== undefined && !measured),
    };
  };
  const neededKeys = new Set(needed.map(({ property }) => sameName(property)));
  return [
    ...needed.map((need) => lineOf(need.property, need)),
    ...[...groups.entries()]
      .filter(([key]) => !neededKeys.has(key))
      .map(([, group]) => lineOf(group.property, undefined)),
  ];
};

/** Why a space's sizes weren't read or saved. */
export type SpaceRefusal =
  | SizeRefusal
  /** It isn't a space: no Thing by that name, or one that's an item or a tool. */
  | { readonly kind: "no-space"; readonly thing: ThingSlug }
  /** The list of old sizes isn't as it was read: confirmed already, or its sentences changed. */
  | { readonly kind: "old-sizes-changed" };

type SpaceTarget = Pick<PlanningFilesTarget, "contextDir" | "workspaceId">;

/** What a space's page is read from: its Things and records, and the sizes its Builds need. */
type SpaceRead = {
  readonly folder: string;
  readonly things: readonly ReadThing[];
  readonly space: ReadThing;
  readonly sizes: readonly ReadSize[];
  readonly problems: SpaceSizes["problems"];
  readonly needed: Needed[];
  readonly oldSizes: OldSize[];
};

const readSpaceIn = async (
  target: SpaceTarget,
  slug: ThingSlug,
): Promise<Result<SpaceRead, SpaceRefusal>> => {
  const folder = await planningFolder(target);
  if (!folder.ok) return folder;
  const [sizes, things, projects, context] = await Promise.all([
    readSizes(target),
    readThingsIn(folder.value),
    readProjects(target),
    readTextFile(join(folder.value, CONTEXT_FILE)),
  ]);
  if (!sizes.ok) return sizes;
  if (!things.ok || !projects.ok || !context.ok) return err({ kind: "storage" });
  const space = things.value.things.find(
    ({ summary }) => summary.slug === slug && summary.kind === "space",
  );
  if (space === undefined) return err({ kind: "no-space", thing: slug });

  // The sizes its Builds need: each step that makes one and isn't done, by its needs (#710).
  const needed: Needed[] = SPACE_NEEDS.map((need) => ({ ...need, builds: [] }));
  const sentences: OldSentence[] = [];
  for (const { project, text } of projects.value.projects) {
    for (const step of project.steps) {
      if (step.build === undefined || step.done) continue;
      for (const need of step.needs) {
        const there = needed.find(({ property }) => sameName(property) === sameName(need.what));
        if (there === undefined) {
          needed.push({
            property: needName(need.what),
            where: `for ${step.text}`,
            builds: [step.build],
          });
        } else if (!there.builds.includes(step.build)) {
          there.builds.push(step.build);
        }
      }
    }
    const read = readProjectText(text);
    if (read.ok) {
      for (const line of read.value.history) {
        sentences.push({ sentence: line.text, from: project.name, day: line.date });
      }
    }
  }

  // Old sizes, until they're confirmed: the space's own size and history, Facts and projects.
  const { subject } = space.summary;
  const confirmed =
    subject === undefined
      ? { ok: true as const, value: undefined }
      : await readTextFile(join(folder.value, confirmedPath(subject)));
  if (!confirmed.ok) return err({ kind: "storage" });
  let oldSizes: OldSize[] = [];
  if (confirmed.value === undefined) {
    const { name, size } = space.summary;
    const own: OldSentence[] = [
      ...(size === undefined ? [] : [{ sentence: size, from: name, day: null }]),
      ...space.history.map((line) => ({ sentence: line.text, from: name, day: line.date })),
    ];
    const facts = parseContextFile(context.value ?? "").facts.map((fact) => ({
      sentence: fact,
      from: "Facts",
      day: null,
    }));
    const recorded = sizes.value.sizes.filter(
      (one) => standing(one) && one.record.subject === subject,
    );
    oldSizes = oldSizesIn([...own, ...facts, ...sentences]).filter(
      (old) =>
        !recorded.some(
          ({ record }) =>
            sameName(record.property) === sameName(old.property) &&
            sameValue(record.value, old.value),
        ),
    );
  }

  return ok({
    folder: folder.value,
    things: things.value.things,
    space,
    sizes: sizes.value.sizes,
    problems: [...sizes.value.problems],
    needed,
    oldSizes,
  });
};

const thingSizes = (thing: ReadThing, lines: SizeLine[]): ThingSizes => ({
  thing: { slug: thing.summary.slug, name: thing.summary.name, kind: thing.summary.kind },
  lines,
});

const viewOf = (read: SpaceRead, workspace: SpaceSizes["workspace"]): SpaceSizes => ({
  workspace,
  space: thingSizes(read.space, linesOf(read.sizes, read.space.summary.subject, read.needed)),
  parts: read.things
    .filter(({ summary }) => summary.kind !== "space")
    .map((thing) => thingSizes(thing, linesOf(read.sizes, thing.summary.subject, [])))
    .filter(({ lines }) => lines.length > 0),
  oldSizes: read.oldSizes,
  problems: [...read.problems],
});

/** A space as Fabrication's room opens it (#709), in its workspace, by its Thing's file's name. */
export const readSpace = async (
  target: SpaceTarget,
  workspace: { readonly id: WorkspaceId; readonly name: string },
  slug: ThingSlug,
): Promise<Result<SpaceSizes, SpaceRefusal>> => {
  const read = await readSpaceIn(target, slug);
  return read.ok ? ok(viewOf(read.value, { ...workspace })) : read;
};

/**
 * The sizes a Build's steps need, by the space each is of: the workspace's first space holds them,
 * as a workspace is one area. None when it has no space.
 */
export const buildSizes = async (
  target: SpaceTarget,
  build: BuildSlug,
): Promise<Result<ThingSizes[], SpaceRefusal>> => {
  const folder = await planningFolder(target);
  if (!folder.ok) return folder;
  const things = await readThingsIn(folder.value);
  if (!things.ok) return err({ kind: "storage" });
  const space = things.value.things.find(({ summary }) => summary.kind === "space");
  if (space === undefined) return ok([]);
  const read = await readSpaceIn(target, space.summary.slug);
  if (!read.ok) return read;
  const lines = linesOf(read.value.sizes, space.summary.subject, read.value.needed).filter(
    ({ builds }) => builds.includes(build),
  );
  return ok(lines.length === 0 ? [] : [thingSizes(space, lines)]);
};

/** Where a size the owner gave in Fabrication came from: measured just now, or about. */
const sourceOf = (source: OwnerSizeSource, now: number): RecordSource =>
  source === "measured"
    ? { kind: "measured", said: { fabrication: new Date(now).toISOString() } }
    : { kind: "reported" };

/** A size the owner gives in Fabrication, as a record's edit: observed today. */
export const ownerEdit = (
  edit: { readonly value: SizeRecord["value"]; readonly source: OwnerSizeSource } & (
    | { readonly kind: "add"; readonly thing: ThingSlug; readonly property: string }
    | { readonly kind: "correct"; readonly id: SizeRecord["id"]; readonly revision: number }
  ),
  now: number,
): SizeEdit => ({ ...edit, source: sourceOf(edit.source, now), observed: historyDate(now) });

/**
 * The old sizes confirmed, once, as one change: each picked recorded of the space as the owner
 * named it, measured when ticked and about otherwise, observed the day its sentence was written
 * (today when that isn't known); and the space marked confirmed, so the list isn't offered again.
 */
export const confirmOldSizes = async (
  target: PlanningFilesTarget,
  slug: ThingSlug,
  confirm: OldSizesConfirm,
  options: { readonly now: number },
) => {
  const read = await readSpaceIn(target, slug);
  if (!read.ok) return read;
  // Confirmed only as listed: one found since (a Fact added in chat, say) is offered first.
  const listed = new Set(confirm.listed);
  const { oldSizes } = read.value;
  if (oldSizes.length !== listed.size || oldSizes.some(({ key }) => !listed.has(key))) {
    return err({ kind: "old-sizes-changed" } as const);
  }
  const edits: SizeEdit[] = [];
  for (const pick of confirm.picks) {
    const old = oldSizes.find(({ key }) => key === pick.key);
    if (old === undefined) return err({ kind: "old-sizes-changed" } as const);
    // The same size said twice (in Facts and a history line, say) is recorded once.
    const twice = edits.some(
      (edit) =>
        edit.kind === "add" &&
        sameName(edit.property) === sameName(pick.property) &&
        sameValue(edit.value, old.value),
    );
    if (twice) continue;
    edits.push({
      ...ownerEdit(
        {
          kind: "add",
          thing: slug,
          property: pick.property,
          value: old.value,
          source: pick.measured ? "measured" : "reported",
        },
        options.now,
      ),
      ...(old.day === null || !ObservedDay.safeParse(old.day).success ? {} : { observed: old.day }),
    });
  }
  if (oldSizes.length === 0) return err({ kind: "old-sizes-changed" } as const);
  return saveSizes(target, edits, {
    now: options.now,
    title: `Confirm old sizes: ${read.value.space.summary.name}`,
    confirmed: slug,
  });
};
