import type { RecipeGroup } from "@courtyard/contract";
import { box, cutSize, tenth } from "./geometry.ts";
import { type Body, type Ctx, type Placed, said } from "./layout.ts";

// Legs and their frames (#770): four legs at the corners, their wide faces along the build. A
// frame on the front and back has long rails on the legs' outer faces, the full length; a frame
// on the ends has end rails between the legs, on their inner faces. Each frame has a rail flush
// with the leg tops and one `lower` above their feet. A shelf rests on the lower long rails between
// the end frames; brace panels go on the outside of the ends and the back, from a frame's lower
// rails to the leg tops, each as wide as the end frames.

/** What a shelf leaves between itself and each end frame, so it drops in. */
const SHELF_GAP = 2;

type Legs = Extract<RecipeGroup, { kind: "legs" }>;
type Frame = Extract<RecipeGroup, { kind: "frame" }>;

/** The legs, their frames, and the shelves and braces on those. */
export const legsBody = (ctx: Ctx, legs: Legs): Body => {
  const { recipe, left, right, front, back, foot } = ctx;
  const problems: string[] = [];
  const timber = ctx.timber(legs.stock);
  const thick = timber.thickness.value;
  const wide = timber.width.value;
  const frames = recipe.groups.filter(
    (group): group is Frame => group.kind === "frame" && group.legs === legs.id,
  );
  const longs = frames.filter((frame) => frame.sides === "front-and-back");
  const ends = frames.filter((frame) => frame.sides === "ends");
  for (const extra of [longs[1], ends[1]]) {
    if (extra) {
      problems.push(
        `${ctx.at(extra)}: Legs have one frame on their ends and one on their front and back.`,
      );
    }
  }
  const long = longs[0];
  const end = ends[0];
  const longTimber = long && ctx.timber(long.stock);
  const endTimber = end && ctx.timber(end.stock);
  const longThick = longTimber?.thickness.value ?? 0;
  const endThick = endTimber?.thickness.value ?? 0;
  const frameLength = right - left;
  const frameDepth = back - front;
  const leg = cutSize(ctx.height);
  const legTop = tenth(foot + leg);
  /** Between the long rails' inner faces, front to back: an end rail's length. */
  const inside = frameDepth - 2 * longThick;
  /** Between the end frames' inner faces. */
  const between = frameLength - 2 * (wide + endThick);

  if (inside <= 0) problems.push("The build is too shallow for its frame.");
  if (between <= 0) problems.push("The build is too short for its end frames.");
  if (leg <= 0) problems.push("The build is too low for its top and what it stands on.");
  for (const frame of frames) {
    const railWide = ctx.timber(frame.stock).width.value;
    if (leg > 0 && frame.lower.value + 2 * railWide > leg) {
      problems.push(`${ctx.at(frame)}: The lower rails are too high: they'd meet the upper rails.`);
    }
  }
  if (problems.length > 0) {
    return { placed: [], problems, topZ: legTop, across: undefined };
  }

  const upperOf = (frame: Frame) => legTop - ctx.timber(frame.stock).width.value;
  const lowerOf = (frame: Frame) => foot + frame.lower.value;
  const shelves = recipe.groups.filter(
    (group): group is Extract<RecipeGroup, { kind: "shelf" }> =>
      group.kind === "shelf" && frames.some((frame) => frame.id === group.on),
  );
  const shelfOn = long && shelves.find((shelf) => shelf.on === long.id);
  const placed: Placed[] = [
    {
      from: legs.id,
      name: ctx.name(legs.id),
      does: `One at each corner, standing on ${ctx.base ? `the ${said(ctx.name(ctx.base.id))}` : "the floor"}.`,
      stock: legs.stock,
      kind: "timber",
      length: leg,
      width: wide,
      thickness: thick,
      legs: true,
      boxes: [left, right - wide].flatMap((x) =>
        [front + longThick, back - longThick - thick].map((y) => box(x, y, foot, wide, thick, leg)),
      ),
    },
  ];
  if (long && longTimber) {
    const railWide = longTimber.width.value;
    placed.push({
      from: long.id,
      name: "Long rails",
      does: `Front and back, top and bottom. The top pair holds ${ctx.top ? `the ${said(ctx.name(ctx.top.id))}` : "the frame square"}, the bottom pair ${shelfOn ? `the ${said(ctx.name(shelfOn.id))}` : "stiffens the frame"}.`,
      stock: long.stock,
      kind: "timber",
      length: cutSize(frameLength),
      width: railWide,
      thickness: longThick,
      boxes: [front, back - longThick].flatMap((y) =>
        [upperOf(long), lowerOf(long)].map((z) =>
          box(left, y, z, frameLength, longThick, railWide),
        ),
      ),
    });
  }
  if (end && endTimber) {
    const railWide = endTimber.width.value;
    placed.push({
      from: end.id,
      name: "End rails",
      does: "Join each end's two legs, top and bottom, making the two end frames.",
      stock: end.stock,
      kind: "timber",
      length: cutSize(inside),
      width: railWide,
      thickness: endThick,
      boxes: [left + wide, right - wide - endThick].flatMap((x) =>
        [upperOf(end), lowerOf(end)].map((z) =>
          box(x, front + longThick, z, endThick, inside, railWide),
        ),
      ),
    });
  }

  for (const shelf of shelves) {
    if (shelf !== shelfOn || shelf.rests !== "rails") {
      problems.push(
        `${ctx.at(shelf)}: A shelf in a frame rests on its lower rails, one along the front and back.`,
      );
      continue;
    }
    if (!long || !longTimber) continue;
    const sheet = ctx.sheet(shelf.stock).thickness.value;
    const shelfLength = between - 2 * SHELF_GAP;
    placed.push({
      from: shelf.id,
      name: ctx.name(shelf.id),
      does: `Rests on the lower long rails, between the ${end ? "end frames" : "legs"}.`,
      stock: shelf.stock,
      kind: "sheet",
      length: cutSize(shelfLength),
      width: cutSize(frameDepth),
      thickness: sheet,
      boxes: [
        box(
          left + wide + endThick + SHELF_GAP,
          front,
          lowerOf(long) + longTimber.width.value,
          shelfLength,
          frameDepth,
          sheet,
        ),
      ],
    });
  }

  const braces = recipe.groups.filter(
    (group): group is Extract<RecipeGroup, { kind: "brace" }> =>
      group.kind === "brace" && frames.some((frame) => frame.id === group.on),
  );
  for (const brace of braces) {
    const frame = frames.find((each) => each.id === brace.on);
    if (frame === undefined) continue;
    const sheet = ctx.sheet(brace.stock).thickness.value;
    const height = leg - frame.lower.value;
    const z = lowerOf(frame);
    const onEnds = brace.sides.includes("ends");
    const onBack = brace.sides.includes("back");
    const sides =
      onEnds && onBack
        ? "the outside of the ends and the back"
        : onEnds
          ? "the outside of the ends"
          : "the back";
    placed.push({
      from: brace.id,
      name: ctx.name(brace.id),
      does: `On ${sides}, so the frame can't rack.`,
      stock: brace.stock,
      kind: "sheet",
      length: cutSize(inside),
      width: cutSize(height),
      thickness: sheet,
      boxes: [
        ...(onEnds
          ? [left - sheet, right].map((x) => box(x, front + longThick, z, sheet, inside, height))
          : []),
        ...(onBack ? [box((ctx.length - inside) / 2, back, z, inside, sheet, height)] : []),
      ],
    });
  }

  return {
    placed,
    problems,
    topZ: legTop,
    across: long ? { y: front + longThick, depth: inside } : undefined,
  };
};
