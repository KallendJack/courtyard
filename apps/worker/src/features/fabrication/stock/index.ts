import { join } from "node:path";
import { type ChangeId, type HaveIt, StockKind, ThingFields, ThingSlug } from "@courtyard/contract";
import { type Held, sameStock } from "@courtyard/fabrication";
import { writeTextFileIn } from "../../../lib/files.ts";
import { err, ok, type Result } from "../../../lib/result.ts";
import { undoWholeFiles, type WholeFilesUndoRefusal } from "../../context-folder/index.ts";
import { slugFor } from "../../planning-files/index.ts";
import { type ReadThing, readThingsIn, readThingText, thingText } from "../../things/index.ts";
import { OWNER_THINGS_FOLDER } from "../../workspaces/index.ts";
import type { ToolsTarget } from "../tools.ts";

// Your stock (#760): the materials and fixings the owner has for making, Things of kind material
// or fixing in the context folder's own `things`, beside their tools, so every Build's buy list
// leaves off what they have. Have it on a buy-list line saves one, as one change with Undo.

/** Why Have it wasn't saved. */
export type StockRefusal =
  /** Its name is one of the owner's tools. */
  | { readonly kind: "tool"; readonly name: string }
  | { readonly kind: "invalid"; readonly problem: string }
  /** Your stock has as many already. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "storage" };

const isStock = ({ summary }: ReadThing) => StockKind.safeParse(summary.kind).success;

/** Your stock, from the owner's things, as a Build is worked out with it. */
export const heldIn = (things: readonly ReadThing[]): Held[] =>
  things.filter(isStock).map(({ summary }) => ({
    name: summary.name,
    count: summary.count ?? 1,
    ...(summary.where === undefined ? {} : { where: summary.where }),
  }));

/**
 * Have it: the line's item saved to Your stock with at least the count given, as one change. What
 * Your stock has of it already (by its file, or a name that's the same stock: "4x40 screws") is
 * topped up, keeping its name, where it's kept and its history; else it's a new Thing.
 */
export const saveHaveIt = async (
  target: ToolsTarget,
  have: HaveIt,
): Promise<Result<{ change: ChangeId | undefined }, StockRefusal>> => {
  let path = "";
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<null, StockRefusal>> => {
      const slug = slugFor(have.name, { slug: ThingSlug, kind: "thing" });
      if (slug === undefined) {
        return err({ kind: "invalid", problem: "Its name needs a letter or a digit." });
      }
      const read = await readThingsIn(target.contextDir);
      if (!read.ok) return err({ kind: "storage" });
      const { things } = read.value;
      const named = things.find(({ summary }) => summary.slug === slug);
      if (named !== undefined && !isStock(named)) {
        return err({ kind: "tool", name: named.summary.name });
      }
      const there =
        named ?? things.find((thing) => isStock(thing) && sameStock(thing.summary.name, have.name));
      const was = there === undefined ? undefined : readThingText(there.text);
      if (was?.ok === false) return err({ kind: "storage" });
      const count = Math.max(there?.summary.count ?? 0, have.count);
      if (there !== undefined && count === (there.summary.count ?? 1)) {
        return err({ kind: "unchanged" });
      }
      const fields = ThingFields.safeParse({
        ...(was?.value.fields ?? { name: have.name, status: "have", kind: have.kind }),
        count,
      });
      if (!fields.success) {
        return err({ kind: "invalid", problem: fields.error.issues[0]?.message ?? "" });
      }
      const file = `${there?.summary.slug ?? slug}.md`;
      const text = thingText(fields.data, was?.value.history ?? []);
      if (!(await writeTextFileIn(join(target.contextDir, OWNER_THINGS_FOLDER, file), text))) {
        return err({ kind: "storage" });
      }
      path = `${OWNER_THINGS_FOLDER}/${file}`;
      return ok(null);
    },
    () => ({
      kind: "thing",
      title: `Have it: ${have.name}`,
      places: [{ kind: "owner-context" }],
      files: [path],
    }),
  );
  return saved.ok ? ok({ change: saved.value.id }) : saved;
};

/** Undoes Have it, as a change of its own, unless the file it changed has since. */
export const undoHaveIt = (
  target: ToolsTarget,
  change: ChangeId,
): Promise<Result<null, WholeFilesUndoRefusal>> =>
  undoWholeFiles(target, { id: change, kinds: ["thing"] });
