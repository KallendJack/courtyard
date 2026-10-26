import type { RecipeGroup } from "@courtyard/contract";
import type { Box } from "../build.ts";
import { box, cutSize, tenth } from "./geometry.ts";
import { type Body, type Ctx, type Placed, said } from "./layout.ts";

// A box or carcass of sheet (#770), open on one side, its panels screwed through each other's
// faces into the next one's edges. Open at the front, it's a back the full size, with the sides on
// its face and the top and bottom between them; open at the top, a bottom the full size, with the
// front and back standing on it and the ends between them. Its shelves rest on cleats, strips of
// their own sheet screwed to the box's sides, spaced evenly up the inside.

/** What a shelf leaves between itself and each side, so it drops in. */
const SHELF_GAP = 2;
/** How deep a shelf's cleat is: room for its screws, and narrow enough not to show. */
const CLEAT = 50;

type BoxGroup = Extract<RecipeGroup, { kind: "box" }>;

const panel = (
  ctx: Ctx,
  of: BoxGroup,
  name: string,
  does: string,
  size: { length: number; width: number },
  boxes: Box[],
): Placed => ({
  from: of.id,
  name: `${ctx.name(of.id)} ${name}`,
  does,
  stock: of.stock,
  kind: "sheet",
  length: cutSize(size.length),
  width: cutSize(size.width),
  thickness: ctx.sheet(of.stock).thickness.value,
  boxes,
});

/** The box's panels, and its shelves on their cleats. */
export const carcassBody = (ctx: Ctx, of: BoxGroup): Body => {
  const { left, right, front, back, foot } = ctx;
  const sheet = ctx.sheet(of.stock).thickness.value;
  const length = right - left;
  const depth = back - front;
  const height = cutSize(ctx.height);
  const topZ = tenth(foot + height);
  if (height <= 2 * sheet || length <= 2 * sheet || depth <= 2 * sheet) {
    return {
      placed: [],
      problems: [`${ctx.at(of)}: The box is too small for its sheet.`],
      topZ,
      across: undefined,
    };
  }
  const placed: Placed[] =
    of.open === "front"
      ? [
          panel(ctx, of, "back", "The back, holding the box square.", { length, width: height }, [
            box(left, back - sheet, foot, length, sheet, height),
          ]),
          panel(
            ctx,
            of,
            "sides",
            "The two sides, screwed into the back's edges.",
            { length: depth - sheet, width: height },
            [left, right - sheet].map((x) => box(x, front, foot, sheet, depth - sheet, height)),
          ),
          panel(
            ctx,
            of,
            "top and bottom",
            "Between the sides, at the top and the bottom.",
            { length: length - 2 * sheet, width: depth - sheet },
            [foot, topZ - sheet].map((z) =>
              box(left + sheet, front, z, length - 2 * sheet, depth - sheet, sheet),
            ),
          ),
        ]
      : [
          panel(
            ctx,
            of,
            "bottom",
            "The bottom, the sides standing on it.",
            { length, width: depth },
            [box(left, front, foot, length, depth, sheet)],
          ),
          panel(
            ctx,
            of,
            "front and back",
            "Front and back, standing on the bottom.",
            { length, width: height - sheet },
            [front, back - sheet].map((y) =>
              box(left, y, foot + sheet, length, sheet, height - sheet),
            ),
          ),
          panel(
            ctx,
            of,
            "ends",
            "The ends, between the front and back.",
            { length: depth - 2 * sheet, width: height - sheet },
            [left, right - sheet].map((x) =>
              box(x, front + sheet, foot + sheet, sheet, depth - 2 * sheet, height - sheet),
            ),
          ),
        ];

  // The space inside, which its shelves divide evenly.
  const inside = {
    x: left + sheet,
    width: length - 2 * sheet,
    y: of.open === "front" ? front : front + sheet,
    depth: of.open === "front" ? depth - sheet : depth - 2 * sheet,
    z: foot + sheet,
    height: of.open === "front" ? height - 2 * sheet : height - sheet,
  };
  const problems: string[] = [];
  const shelves = ctx.recipe.groups.filter(
    (group): group is Extract<RecipeGroup, { kind: "shelf" }> =>
      group.kind === "shelf" && group.on === of.id,
  );
  for (const shelf of shelves) {
    if (shelf.rests !== "cleats") {
      problems.push(`${ctx.at(shelf)}: A shelf in a box rests on cleats.`);
    }
  }
  const thicknesses = shelves.map((shelf) => ctx.sheet(shelf.stock).thickness.value);
  const space =
    (inside.height - thicknesses.reduce((sum, mm) => sum + mm, 0)) / (shelves.length + 1);
  if (shelves.length > 0 && space < CLEAT) {
    problems.push(`${ctx.at(of)}: The box is too low for ${shelves.length} shelves.`);
  }
  if (problems.length > 0) return { placed, problems, topZ, across: undefined };

  let z = inside.z;
  shelves.forEach((shelf, index) => {
    const thick = thicknesses[index] ?? 0;
    z += space;
    const shelfLength = inside.width - 2 * SHELF_GAP;
    placed.push(
      {
        from: shelf.id,
        name: ctx.name(shelf.id),
        does: `Rests on its cleats, between the ${said(ctx.name(of.id))}'s sides.`,
        stock: shelf.stock,
        kind: "sheet",
        length: cutSize(shelfLength),
        width: cutSize(inside.depth),
        thickness: thick,
        boxes: [box(inside.x + SHELF_GAP, inside.y, z, shelfLength, inside.depth, thick)],
      },
      {
        // The cleats are the box's: screwed to its sides, with its screws.
        from: of.id,
        name: `${ctx.name(shelf.id)} cleats`,
        does: `Screwed to the sides, the ${said(ctx.name(shelf.id))} resting on them.`,
        stock: shelf.stock,
        kind: "sheet",
        length: cutSize(inside.depth),
        width: CLEAT,
        thickness: thick,
        boxes: [inside.x, inside.x + inside.width - thick].map((x) =>
          box(x, inside.y, z - CLEAT, thick, inside.depth, CLEAT),
        ),
      },
    );
    z += thick;
  });
  return { placed, problems, topZ, across: undefined };
};
