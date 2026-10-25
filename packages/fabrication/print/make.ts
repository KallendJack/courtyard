/// <reference path="./opentype.d.ts" />
import type { Face, PartBase, PartFeature } from "@courtyard/contract";
import Module, { type CrossSection, type Manifold, type ManifoldToplevel } from "manifold-3d";
import type { Font } from "opentype.js";
import { err, ok, type Result } from "../build.ts";
import { outlinesOf } from "./lettering.ts";
import {
  baseBox,
  type CheckedRecipe,
  type FaceFrame,
  faceFrame,
  headDiameter,
  holeDiameter,
  pocketSize,
} from "./recipe.ts";

// A checked recipe made into a solid (#702) with manifold (Apache-2.0, WebAssembly): the base,
// then its corners rounded or cut, its pockets, slots and holes, and its lettering. Every solid
// manifold makes is closed all round, so a slicer reads the file as it is.

/** How far a cut reaches past the faces it opens, so no skin is left. */
const PAST = 1;
/** How many sides a hole's circle has: fine enough that a screw meets no flats. */
const ROUND = 48;
/**
 * How much of a pocket or a line of lettering must have the part under it, by volume: all of it
 * on a flat face, less a little where a fillet rounds a corner it comes near.
 */
const ON_PART_LEAST = 0.9;

/** A part as made: its size and volume, whether it's closed all round, and its triangles. */
export type Made = {
  readonly size: { readonly length: number; readonly depth: number; readonly height: number };
  /** mm³. */
  readonly volume: number;
  readonly watertight: boolean;
  /** x, y, z for each corner, flat, in mm with the part's lowest point on the plate. */
  readonly positions: Float32Array;
  /** Three corners for each triangle, outside anticlockwise. */
  readonly triangles: Uint32Array;
};

let loaded: Promise<ManifoldToplevel> | undefined;

/** manifold's WebAssembly, loaded once. */
const manifold = () => {
  loaded ??= Module().then((wasm) => {
    wasm.setup();
    return wasm;
  });
  return loaded;
};

/** A face's frame as manifold's 4 × 4 transform, column by column. */
const placeOn = (frame: FaceFrame) =>
  [...frame.across, 0, ...frame.up, 0, ...frame.out, 0, ...frame.origin, 1] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

const AXIS: Readonly<Record<Face, { readonly index: 0 | 1 | 2; readonly sign: 1 | -1 }>> = {
  top: { index: 2, sign: 1 },
  bottom: { index: 2, sign: -1 },
  front: { index: 1, sign: -1 },
  back: { index: 1, sign: 1 },
  left: { index: 0, sign: -1 },
  right: { index: 0, sign: 1 },
};

/**
 * Makes a checked recipe into a solid. `font` is needed only for lettering. What can't be made as
 * written (lettering wider than its face, a hole that misses the part, a pocket or lettering
 * without the part under it, a part in pieces or of nothing) comes back as reasons, as does a
 * part manifold fails on, so only one closed solid is ever made.
 */
export const makePart = async (
  recipe: CheckedRecipe,
  options: { font?: Font } = {},
): Promise<Result<Made, string[]>> => {
  const wasm = await manifold();
  const { Manifold, CrossSection } = wasm;
  // manifold's objects live in WebAssembly's memory: each is freed once the part is made.
  const made: (Manifold | CrossSection)[] = [];
  const kept = <T extends Manifold | CrossSection>(one: T): T => {
    made.push(one);
    return one;
  };
  const problems: string[] = [];
  try {
    const { base, features, clearance } = recipe;
    const box = baseBox(base);
    let solid = kept(baseSolid(wasm, base));

    /** A flat shape on a face, pushed `from` → `to` mm along its outward axis, in place. */
    const onFace = (face: Face, shape: CrossSection, from: number, to: number) =>
      kept(
        kept(kept(Manifold.extrude(shape, to - from)).translate([0, 0, from])).transform(
          placeOn(faceFrame(base, face)),
        ),
      );

    /**
     * Whether a flat shape on a face has the part under it, `depth` mm in: a face is its box's
     * side, which is the part all over only on a box or a plate, so a pocket on a cylinder's
     * curved side or lettering on the empty part of an L-bracket's top would cut nothing, or float.
     */
    const onPart = (face: Face, shape: CrossSection, depth: number) =>
      kept(solid.intersect(onFace(face, shape, -depth, 0))).volume() >=
      ON_PART_LEAST * shape.area() * depth;

    /** How many separate bodies the part is now. */
    const bodies = () => solid.decompose().map(kept).length;

    const corners = (feature: PartFeature & { kind: "fillet" | "chamfer" }) => {
      const { w, d } = box;
      const outline =
        feature.kind === "fillet"
          ? kept(
              kept(kept(CrossSection.square([w, d])).offset(-feature.radius, "Round")).offset(
                feature.radius,
                "Round",
                2,
                ROUND,
              ),
            )
          : kept(
              CrossSection.ofPolygons([
                [
                  [feature.size, 0],
                  [w - feature.size, 0],
                  [w, feature.size],
                  [w, d - feature.size],
                  [w - feature.size, d],
                  [feature.size, d],
                  [0, d - feature.size],
                  [0, feature.size],
                ],
              ]),
            );
      return kept(kept(Manifold.extrude(outline, box.h + 2 * PAST)).translate([0, 0, -PAST]));
    };

    for (const feature of features) {
      if (feature.kind === "fillet" || feature.kind === "chamfer") {
        solid = kept(solid.intersect(corners(feature)));
      }
    }
    for (const feature of features) {
      if (feature.kind !== "pocket") continue;
      const frame = faceFrame(base, feature.face);
      const size = pocketSize(
        {
          width: feature.object.width.value,
          height: feature.object.height.value,
          depth: feature.object.depth.value,
        },
        clearance,
      );
      const at = feature.at ?? { u: frame.U / 2, v: frame.V / 2 };
      const open = new Set(feature.open);
      const u0 = open.has("left") ? -PAST : at.u - size.width / 2;
      const u1 = open.has("right") ? frame.U + PAST : at.u + size.width / 2;
      const v0 = open.has("down") ? -PAST : at.v - size.height / 2;
      const v1 = open.has("up") ? frame.V + PAST : at.v + size.height / 2;
      const rect = kept(kept(CrossSection.square([u1 - u0, v1 - v0])).translate([u0, v0]));
      const onItsFace = kept(rect.intersect(kept(CrossSection.square([frame.U, frame.V]))));
      if (!onPart(feature.face, onItsFace, size.depth)) {
        problems.push(
          `The pocket for the ${feature.object.name} isn't all in the part there: ${elsewhere(base, feature.face)}.`,
        );
        continue;
      }
      solid = kept(solid.subtract(onFace(feature.face, rect, -size.depth, PAST)));
    }
    for (const feature of features) {
      if (feature.kind !== "slot") continue;
      const frame = faceFrame(base, feature.face);
      const radius = holeDiameter(feature.screw.diameter.value, clearance) / 2;
      const reach = feature.length / 2 - radius;
      const ends = [-reach, reach].map((u) =>
        kept(kept(CrossSection.circle(radius, ROUND)).translate([feature.at.u + u, feature.at.v])),
      );
      const outline = kept(CrossSection.hull(ends));
      const cut = onFace(feature.face, outline, -frame.D - PAST, PAST);
      if (kept(solid.intersect(cut)).isEmpty()) {
        problems.push(`The slot for the ${feature.screw.name} misses the part: move it onto it.`);
        continue;
      }
      solid = kept(solid.subtract(cut));
    }
    for (const feature of features) {
      if (feature.kind !== "hole") continue;
      const frame = faceFrame(base, feature.face);
      const radius = holeDiameter(feature.screw.diameter.value, clearance) / 2;
      const circle = kept(
        kept(CrossSection.circle(radius, ROUND)).translate([feature.at.u, feature.at.v]),
      );
      const shaft = onFace(feature.face, circle, -frame.D - PAST, PAST);
      // Where the hole first meets the part, coming in from its face: a countersink goes there.
      const met = kept(solid.intersect(shaft));
      if (met.isEmpty()) {
        problems.push(`The hole for the ${feature.screw.name} misses the part: move it onto it.`);
        continue;
      }
      if (feature.countersunk) {
        const { index, sign } = AXIS[feature.face];
        const bounds = met.boundingBox();
        const entry = sign > 0 ? bounds.max[index] : bounds.min[index];
        const depthIn = (frame.origin[index] - entry) * sign;
        const head = headDiameter(feature.screw.diameter.value, clearance) / 2;
        // A 90° cone, from the head's width at the face down to the hole's, and open above it.
        const cone = kept(
          kept(
            kept(Manifold.cylinder(head - radius + PAST, radius, head + PAST, ROUND)).translate([
              feature.at.u,
              feature.at.v,
              -depthIn - (head - radius),
            ]),
          ).transform(placeOn(frame)),
        );
        solid = kept(solid.subtract(cone));
      }
      solid = kept(solid.subtract(shaft));
    }
    for (const feature of features) {
      if (feature.kind !== "text") continue;
      if (options.font === undefined) {
        problems.push("Lettering needs the font, which wasn't loaded.");
        continue;
      }
      const frame = faceFrame(base, feature.face);
      const outlines = outlinesOf(options.font, feature.text, feature.size);
      const at = feature.at ?? { u: frame.U / 2, v: frame.V / 2 };
      if (
        at.u - outlines.width / 2 < 0 ||
        at.u + outlines.width / 2 > frame.U ||
        at.v - outlines.height / 2 < 0 ||
        at.v + outlines.height / 2 > frame.V
      ) {
        problems.push(
          `The lettering "${feature.text}" is ${Math.round(outlines.width)} mm wide at ${feature.size} mm tall, more than its face has room for: make it smaller or shorter.`,
        );
        continue;
      }
      const letters = kept(
        kept(CrossSection.ofPolygons(outlines.contours, "NonZero")).translate([at.u, at.v]),
      );
      // Raised lettering needs the part just under it; cut lettering, all the way in.
      if (feature.style === "cut") {
        if (!onPart(feature.face, letters, feature.depth)) {
          problems.push(
            `The lettering "${feature.text}" isn't all on the part there: ${elsewhere(base, feature.face)}.`,
          );
          continue;
        }
        solid = kept(solid.subtract(onFace(feature.face, letters, -feature.depth, PAST)));
        continue;
      }
      const under = onPart(feature.face, letters, PAST / 10);
      const before = bodies();
      solid = kept(solid.add(onFace(feature.face, letters, -PAST / 10, feature.depth)));
      // A letter off the part's edge, or over a curve, stands in the air: a body of its own.
      if (!under || bodies() > before) {
        problems.push(
          `The lettering "${feature.text}" isn't all on the part there: ${elsewhere(base, feature.face)}.`,
        );
      }
    }
    if (problems.length > 0) return err(problems);
    // What's served is one closed solid, or nothing: never an empty or broken file.
    if (solid.isEmpty() || solid.status() !== "NoError") {
      return err(["It comes out as nothing to print: check its sizes."]);
    }
    const pieces = bodies();
    if (pieces > 1) {
      return err([
        `It comes out in ${pieces} separate pieces: join them up, or make each its own part.`,
      ]);
    }

    const bounds = solid.boundingBox();
    const placed = kept(solid.translate([-bounds.min[0], -bounds.min[1], -bounds.min[2]]));
    const mesh = placed.getMesh();
    const positions = new Float32Array((mesh.vertProperties.length / mesh.numProp) * 3);
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        positions[vertex * 3 + axis] = mesh.vertProperties[vertex * mesh.numProp + axis] ?? 0;
      }
    }
    const tenth = (mm: number) => Math.round(mm * 100) / 100;
    return ok({
      size: {
        length: tenth(bounds.max[0] - bounds.min[0]),
        depth: tenth(bounds.max[1] - bounds.min[1]),
        height: tenth(bounds.max[2] - bounds.min[2]),
      },
      volume: placed.volume(),
      watertight: placed.status() === "NoError" && !placed.isEmpty(),
      positions,
      triangles: new Uint32Array(mesh.triVerts),
    });
  } catch (error) {
    // manifold's WebAssembly can fail outright on a part it can't make: a trap, or its C++
    // throwing a bare number. That's a refusal, and the next part gets a fresh copy of it, since
    // this one's memory may be broken (and nothing in it is freed). Anything else is a bug.
    const failed =
      typeof error === "number" || (error instanceof Error && error.name === "RuntimeError");
    if (!failed) throw error;
    loaded = undefined;
    made.length = 0;
    return err([MODELLER_FAILED]);
  } finally {
    for (const one of made) one.delete();
  }
};

const MODELLER_FAILED =
  "It couldn't be made: making its solid failed. Make it simpler, with fewer features or less lettering.";

/** Where a feature that isn't all on the part could go instead, for its finding. */
const elsewhere = (base: PartBase, face: Face) => {
  if (base.kind === "cylinder" && face !== "top" && face !== "bottom") {
    return "a cylinder's side is curved, so put it on its top or bottom";
  }
  if (base.kind === "l-bracket" && face !== "bottom" && face !== "back") {
    return "an L-bracket is solid right across only on its bottom and back, so put it there";
  }
  return "move it in, onto the part";
};

/** The base as a solid, its front left bottom corner at the origin. */
const baseSolid = ({ Manifold }: ManifoldToplevel, base: PartBase): Manifold => {
  switch (base.kind) {
    case "box":
      return Manifold.cube([base.width, base.depth, base.height]);
    case "plate":
      return Manifold.cube([base.width, base.depth, base.thickness]);
    case "cylinder": {
      const radius = base.diameter / 2;
      const standing = Manifold.cylinder(base.height, radius, radius, ROUND * 2);
      const placed = standing.translate([radius, radius, 0]);
      standing.delete();
      return placed;
    }
    case "l-bracket": {
      const flat = Manifold.cube([base.width, base.depth, base.thickness]);
      const upright = Manifold.cube([base.width, base.thickness, base.height]).translate([
        0,
        base.depth - base.thickness,
        0,
      ]);
      const bracket = flat.add(upright);
      flat.delete();
      upright.delete();
      return bracket;
    }
  }
};
