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
 * written (lettering wider than its face, a hole that misses the part) comes back as reasons.
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
      solid = kept(solid.subtract(onFace(feature.face, outline, -frame.D - PAST, PAST)));
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
      solid =
        feature.style === "raised"
          ? kept(solid.add(onFace(feature.face, letters, -PAST / 10, feature.depth)))
          : kept(solid.subtract(onFace(feature.face, letters, -feature.depth, PAST)));
    }
    if (problems.length > 0) return err(problems);

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
  } finally {
    for (const one of made) one.delete();
  }
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
