import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ChangeId,
  COMMON_TOOLS,
  type FoundTool,
  ThingFields,
  type ThingHistoryEntry,
  ThingSlug,
  ToolPick,
  type ToolsHeard,
  type WorkspaceId,
  type YourTools,
} from "@courtyard/contract";
import { readBytes, removeFile, writeBytesIn, writeTextFileIn } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { HeardToolsAnswer, TOOLS_HEARING, toolsHeardMessage } from "../../prompts/tools.ts";
import { errandModel, firstWithRoom, modelsOnOffer, type Provider } from "../../providers/index.ts";
import {
  type ContextFolder,
  type Place,
  undoWholeFiles,
  type WholeFilesUndoRefusal,
} from "../context-folder/index.ts";
import { pathInFolder, planningFolder, slugFor } from "../planning-files/index.ts";
import {
  photoName,
  type ReadThing,
  readThingsIn,
  readThingText,
  THINGS_FOLDER,
  thingPath,
  thingText,
} from "../things/index.ts";
import { getWorkspace, listWorkspaces, OWNER_THINGS_FOLDER } from "../workspaces/index.ts";

// The owner's tools (ADR 0037, #707): Things of kind tool at the owner's level, in the context
// folder's own `things` folder, read by every workspace's turns and every Build. Your tools, in
// Fabrication, saves them all at once as one change with Undo, moving a workspace's tools there
// with the owner's Save.

/** Where the owner's tools are kept, and what a change to them names. */
export type ToolsTarget = {
  readonly contextDir: string;
  readonly contextFolder: ContextFolder;
};

/** Why the owner's tools weren't read, saved or undone. */
export type ToolsRefusal =
  /** A tool doesn't fit as a Thing: too long, more than one line, and so on. */
  | { readonly kind: "invalid"; readonly problem: string }
  /** The same tool given twice. */
  | { readonly kind: "twice"; readonly name: string }
  | { readonly kind: "unchanged" }
  /** A workspace's Thing to move isn't there any more, by the workspace's name. */
  | { readonly kind: "gone"; readonly workspace: string; readonly thing: ThingSlug }
  /** A workspace's Thing to move has parts, which stay where they are. */
  | { readonly kind: "has-parts"; readonly name: string }
  | { readonly kind: "storage" };

/** A path in the owner's tools' folder, from the context folder's top, as changes name it. */
const ownerPath = (path: string) => `${OWNER_THINGS_FOLDER}/${path}`;

/** The owner's tools, in order of name, and the files there that can't be read as a Thing. */
export const readTools = async (contextDir: string) => {
  // `readThingsIn` reads a folder's `things`, which for the context folder is the owner's.
  const read = await readThingsIn(contextDir);
  if (!read.ok) return err<ToolsRefusal>({ kind: "storage" });
  return ok({
    tools: read.value.things.filter(({ summary }) => summary.kind === "tool"),
    problems: read.value.problems,
  });
};

/** Words a Thing's name has that make it one of Your tools' tiles, the most particular first. */
const TILE_WORDS: readonly (readonly [string, readonly string[]])[] = [
  ["Impact driver", ["impact driver"]],
  ["Drill / driver", ["drill"]],
  ["Screwdrivers", ["screwdriver"]],
  ["Hand saw", ["hand saw", "handsaw", "panel saw", "tenon saw"]],
  ["Circular saw", ["circular saw"]],
  ["Jigsaw", ["jigsaw", "jig saw"]],
  ["Mitre saw", ["mitre saw", "miter saw", "chop saw"]],
  ["Workmate", ["workmate", "folding workbench"]],
  ["Clamps", ["clamp"]],
  ["Square", ["square"]],
  ["Tape, pencil", ["tape measure", "pencil"]],
  ["Sawhorses", ["sawhorse", "saw horse", "trestle"]],
  ["Spirit level", ["level"]],
  ["Hammer", ["hammer"]],
  ["Sandpaper", ["sandpaper", "abrasive"]],
  ["Sander", ["sander"]],
  ["3D printer", ["3d printer"]],
];

/** Every tile has its words, so none is never found. */
const TILES: readonly string[] = COMMON_TOOLS.flatMap(({ tools }) => tools);
if (TILES.some((tile) => !TILE_WORDS.some(([name]) => name === tile))) {
  throw new Error("A tile of Your tools has no words to find it by.");
}

/** The tool a workspace's Thing would be: a tile's name, its own for a tool of kind tool, or none. */
const toolOf = ({ summary }: ReadThing) => {
  const words = summary.name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tile = TILE_WORDS.find(([, said]) => said.some((one) => words.includes(one)))?.[0];
  return tile ?? (summary.kind === "tool" ? summary.name : undefined);
};

/**
 * Each planning workspace's Things that look like the owner's tools, to move: ones the owner has,
 * by a tile's words or of kind tool, never a part or a Thing with parts.
 */
const findTools = async (contextDir: string): Promise<Result<FoundTool[], ToolsRefusal>> => {
  const workspaces = await listWorkspaces(contextDir);
  if (!workspaces.ok) return err({ kind: "storage" });
  const found: FoundTool[] = [];
  for (const workspace of workspaces.value) {
    if (workspace.mode !== "planning") continue;
    const folder = join(contextDir, workspace.id);
    const read = await readThingsIn(folder);
    if (!read.ok) return err({ kind: "storage" });
    const { things } = read.value;
    for (const thing of things) {
      const { summary } = thing;
      const tool = toolOf(thing);
      const hasParts = things.some((other) => other.summary.partOf === summary.slug);
      if (tool === undefined || summary.status !== "have" || summary.partOf || hasParts) continue;
      found.push({
        tool: { name: tool, from: { workspace: workspace.id, thing: summary.slug } },
        workspaceName: workspace.name,
        thingName: summary.name,
      });
    }
  }
  return ok(found);
};

/** Your tools as Fabrication's API gives them. */
export const yourTools = async (contextDir: string): Promise<Result<YourTools, ToolsRefusal>> => {
  const [read, found] = await Promise.all([readTools(contextDir), findTools(contextDir)]);
  if (!read.ok) return read;
  if (!found.ok) return found;
  return ok({
    tools: read.value.tools.map(({ summary }) => summary),
    problems: [...read.value.problems],
    saved: read.value.tools.length > 0,
    found: found.value,
  });
};

/** A workspace's Thing a tool moves from: it, its workspace's folder and its name. */
type Moving = {
  readonly workspace: WorkspaceId;
  readonly folder: string;
  readonly thing: ReadThing;
};

/** The workspace's Thing a pick moves from, read; or why it can't be moved. */
const movingOf = async (
  contextDir: string,
  from: NonNullable<ToolPick["from"]>,
): Promise<Result<Moving, ToolsRefusal>> => {
  const workspace = await getWorkspace(contextDir, from.workspace);
  const name = workspace.ok ? workspace.value.summary.name : from.workspace;
  const gone = err<ToolsRefusal>({ kind: "gone", workspace: name, thing: from.thing });
  const folder = await planningFolder({ contextDir, workspaceId: from.workspace });
  if (!folder.ok) return gone;
  const read = await readThingsIn(folder.value);
  if (!read.ok) return err({ kind: "storage" });
  const thing = read.value.things.find(({ summary }) => summary.slug === from.thing);
  if (thing === undefined) return gone;
  if (read.value.things.some(({ summary }) => summary.partOf === from.thing)) {
    return err({ kind: "has-parts", name: thing.summary.name });
  }
  return ok({ workspace: from.workspace, folder: folder.value, thing });
};

/**
 * Saves the owner's tools as they ticked them, as one change: each tool written as a Thing of kind
 * tool (a new one, or one whose count, make or size changed), each one not given removed, and each
 * workspace's Thing a tool moves from removed there, what it held (its details, history and photo)
 * going with it. A tool with a size gets its subject ID (ADR 0037). Undo takes it back whole.
 */
export const saveTools = async (
  target: ToolsTarget,
  picks: readonly ToolPick[],
): Promise<Result<{ change: ChangeId | undefined }, ToolsRefusal>> => {
  const owned: string[] = [];
  const moved: string[] = [];
  const places = new Map<string, Place>([["owner", { kind: "owner-context" }]]);
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<null, ToolsRefusal>> => {
      const { contextDir } = target;
      /** A file in the owner's tools' folder: a tool's, or its photo. */
      const toolFile = (name: string) => join(contextDir, OWNER_THINGS_FOLDER, name);
      const read = await readTools(contextDir);
      if (!read.ok) return read;
      const current = new Map(read.value.tools.map((tool) => [tool.summary.slug, tool]));
      /** Each tool given, by its file's name, named as first given. */
      const slugs = new Map<ThingSlug, string>();
      const writes: { slug: ThingSlug; text: string; photo?: Uint8Array }[] = [];
      const leaving: Moving[] = [];

      for (const pick of picks) {
        const slug = slugFor(pick.name, { slug: ThingSlug, kind: "thing" });
        if (slug === undefined) {
          return err({ kind: "invalid", problem: "A tool's name needs a letter or a digit." });
        }
        const first = slugs.get(slug);
        if (first !== undefined) return err({ kind: "twice", name: first });
        slugs.set(slug, pick.name);
        const moving = pick.from === undefined ? undefined : await movingOf(contextDir, pick.from);
        if (moving !== undefined && !moving.ok) return moving;
        const there = current.get(slug);
        const fromThere = there === undefined ? undefined : readThingText(there.text);
        const fromMoving =
          moving === undefined ? undefined : readThingText(moving.value.thing.text);
        if (fromThere?.ok === false || fromMoving?.ok === false) return err({ kind: "storage" });
        // A tool the owner has already keeps what it holds; one moved in brings what it held.
        const were: Partial<ThingFields> =
          fromThere?.value.fields ?? fromMoving?.value.fields ?? {};
        const { partOf: _partOf, photo: _photo, ...kept } = were;
        const movedPhoto = moving?.value.thing.summary.photo && there === undefined;
        const photo = movedPhoto
          ? await readBytes(
              join(moving.value.folder, THINGS_FOLDER, photoName(moving.value.thing.summary.slug)),
            )
          : undefined;
        if (photo !== undefined && !photo.ok) return err({ kind: "storage" });
        const merged: Record<string, unknown> = {
          ...kept,
          name: pick.name,
          status: "have",
          kind: "tool",
          count: pick.count === 1 ? undefined : pick.count,
          ...(pick.brand === undefined ? {} : { brand: pick.brand }),
          ...(pick.size === undefined ? {} : { size: pick.size }),
          ...(there?.summary.photo || photo?.value !== undefined ? { photo: photoName(slug) } : {}),
        };
        if (merged.size !== undefined && merged.subject === undefined)
          merged.subject = randomUUID();
        const fields = ThingFields.safeParse(merged);
        if (!fields.success) {
          return err({ kind: "invalid", problem: fields.error.issues[0]?.message ?? "" });
        }
        const history: readonly ThingHistoryEntry[] = [
          ...(fromThere?.value.history ?? []),
          ...(fromMoving?.value.history ?? []),
        ];
        const text = thingText(fields.data, history);
        if (moving !== undefined) leaving.push(moving.value);
        if (there !== undefined && text === there.text.replace(/\r\n/g, "\n")) continue;
        writes.push({ slug, text, ...(photo?.value === undefined ? {} : { photo: photo.value }) });
      }
      const removing = read.value.tools.filter(({ summary }) => !slugs.has(summary.slug));
      if (writes.length === 0 && removing.length === 0 && leaving.length === 0) {
        return err({ kind: "unchanged" });
      }

      for (const { slug, text, photo } of writes) {
        if (!(await writeTextFileIn(toolFile(`${slug}.md`), text))) {
          return err({ kind: "storage" });
        }
        owned.push(ownerPath(`${slug}.md`));
        if (photo === undefined) continue;
        if (!(await writeBytesIn(toolFile(photoName(slug)), photo))) {
          return err({ kind: "storage" });
        }
        owned.push(ownerPath(photoName(slug)));
      }
      for (const { summary } of removing) {
        if (!(await removeFile(toolFile(`${summary.slug}.md`)))) return err({ kind: "storage" });
        owned.push(ownerPath(`${summary.slug}.md`));
        if (!summary.photo) continue;
        if (!(await removeFile(toolFile(photoName(summary.slug))))) {
          return err({ kind: "storage" });
        }
        owned.push(ownerPath(photoName(summary.slug)));
      }
      for (const { workspace, folder, thing } of leaving) {
        const { slug, photo } = thing.summary;
        if (!(await removeFile(join(folder, THINGS_FOLDER, `${slug}.md`)))) {
          return err({ kind: "storage" });
        }
        moved.push(pathInFolder(workspace, thingPath(slug)));
        if (photo) {
          if (!(await removeFile(join(folder, THINGS_FOLDER, photoName(slug))))) {
            return err({ kind: "storage" });
          }
          moved.push(pathInFolder(workspace, `${THINGS_FOLDER}/${photoName(slug)}`));
        }
        places.set(workspace, { kind: "workspace", id: workspace });
      }
      return ok(null);
    },
    () => ({
      kind: "thing",
      title: "Save your tools",
      places: [...places.values()],
      files: [...owned.sort(), ...moved],
    }),
  );
  return saved.ok ? ok({ change: saved.value.id }) : saved;
};

/** The longest a model takes to tick the tools the owner said. */
const HEARING_TIMEOUT_MS = 60 * 1000;

/**
 * The tools the owner said they have, ticked by one question to a model ("Or just say it"): each
 * by its tile's name or their own, with its count. Nothing is saved; the owner checks them first.
 * `undefined` when no model could answer.
 */
export const hearTools = async (
  providers: readonly Provider[],
  said: string,
): Promise<ToolsHeard | undefined> => {
  // A short errand, on the cheap model where there is one.
  const offered = firstWithRoom(await modelsOnOffer(providers));
  const chosen =
    (await errandModel(providers)) ??
    (offered && { provider: offered.provider, model: offered.model.id, effort: undefined });
  if (chosen === undefined) return undefined;
  const answered = await chosen.provider.answerOnce({
    purpose: "heard-tools",
    model: chosen.model,
    ...(chosen.effort === undefined ? {} : { effort: chosen.effort }),
    instructions: TOOLS_HEARING,
    message: toolsHeardMessage(said),
    schema: HeardToolsAnswer,
    signal: AbortSignal.timeout(HEARING_TIMEOUT_MS),
  });
  const parsed = answered.ok ? HeardToolsAnswer.safeParse(answered.value) : undefined;
  if (!parsed?.success) return undefined;
  const tools = parsed.data.tools.flatMap(({ name, count }) => {
    const tool = ToolPick.omit({ from: true }).safeParse(count > 1 ? { name, count } : { name });
    return tool.success ? [tool.data] : [];
  });
  // Each once, as the owner ticks a tile once.
  return {
    tools: tools.filter(
      (tool, index) =>
        tools.findIndex((other) => other.name.toLowerCase() === tool.name.toLowerCase()) === index,
    ),
  };
};

/** Undoes a save of the owner's tools, as a change of its own, unless a file it changed has since. */
export const undoToolsSave = (
  target: ToolsTarget,
  change: ChangeId,
): Promise<Result<null, WholeFilesUndoRefusal>> =>
  undoWholeFiles(target, { id: change, kinds: ["thing"] });
