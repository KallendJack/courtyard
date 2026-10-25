import {
  type Face,
  PART_FEATURES,
  type PartBase,
  PartFeature,
  type PartRecipe,
  type PrinterSpec,
} from "@courtyard/contract";
import type { Finding } from "../build.ts";

// A part recipe checked (#702): each feature read on its own, then every rule code can check
// before anything is made. A recipe that breaks one is refused with a finding naming each reason,
// and never made; a wall too thin is made, with a finding to check.

type Vec3 = readonly [number, number, number];

/** The base's box, mm: across (`x`), back (`y`) and up (`z`). */
export const baseBox = (base: PartBase) => {
  switch (base.kind) {
    case "box":
      return { w: base.width, d: base.depth, h: base.height };
    case "plate":
      return { w: base.width, d: base.depth, h: base.thickness };
    case "cylinder":
      return { w: base.diameter, d: base.diameter, h: base.height };
    case "l-bracket":
      return { w: base.width, d: base.depth, h: base.height };
  }
};

/**
 * A face as a feature sees it: its size across (`U`) and up (`V`), how far it is through the part
 * to the far side (`D`), and where its lower left corner is with which way is across, up and out,
 * so a feature drawn flat on the face (`u`, `v`, and `w` out of the part) is placed on it.
 */
export type FaceFrame = {
  readonly U: number;
  readonly V: number;
  readonly D: number;
  readonly origin: Vec3;
  readonly across: Vec3;
  readonly up: Vec3;
  readonly out: Vec3;
};

export const faceFrame = (base: PartBase, face: Face): FaceFrame => {
  const { w, d, h } = baseBox(base);
  switch (face) {
    case "top":
      return {
        U: w,
        V: d,
        D: h,
        origin: [0, 0, h],
        across: [1, 0, 0],
        up: [0, 1, 0],
        out: [0, 0, 1],
      };
    case "bottom":
      return {
        U: w,
        V: d,
        D: h,
        origin: [w, 0, 0],
        across: [-1, 0, 0],
        up: [0, 1, 0],
        out: [0, 0, -1],
      };
    case "front":
      return {
        U: w,
        V: h,
        D: d,
        origin: [0, 0, 0],
        across: [1, 0, 0],
        up: [0, 0, 1],
        out: [0, -1, 0],
      };
    case "back":
      return {
        U: w,
        V: h,
        D: d,
        origin: [w, d, 0],
        across: [-1, 0, 0],
        up: [0, 0, 1],
        out: [0, 1, 0],
      };
    case "left":
      return {
        U: d,
        V: h,
        D: w,
        origin: [0, d, 0],
        across: [0, -1, 0],
        up: [0, 0, 1],
        out: [-1, 0, 0],
      };
    case "right":
      return {
        U: d,
        V: h,
        D: w,
        origin: [w, 0, 0],
        across: [0, 1, 0],
        up: [0, 0, 1],
        out: [1, 0, 0],
      };
  }
};

/** A feature's rectangle on its face, mm: from `u0` to `u1` across and `v0` to `v1` up. */
type Rect = { u0: number; u1: number; v0: number; v1: number };

/** A screw's hole: its shank's diameter with the clearance each side. */
export const holeDiameter = (screw: number, clearance: number) => screw + 2 * clearance;

/** A countersink's widest, where the screw goes in: twice the shank, as a wood screw's head is. */
export const headDiameter = (screw: number, clearance: number) => 2 * screw + 2 * clearance;

/** A pocket's size: the object's with the clearance each side across and up, and once behind it. */
export const pocketSize = (
  object: { width: number; height: number; depth: number },
  clearance: number,
) => ({
  width: object.width + 2 * clearance,
  height: object.height + 2 * clearance,
  depth: object.depth + clearance,
});

const round = (mm: number) => Math.round(mm * 100) / 100;

/** A recipe whose features are each known and in reach, ready to make. */
export type CheckedRecipe = {
  readonly base: PartBase;
  readonly features: readonly PartFeature[];
  /** What each hole, slot and pocket allows on top of its screw's or object's size, mm. */
  readonly clearance: number;
  /** The thinnest wall the nozzle prints well: two lines of it, mm. */
  readonly least: number;
};

/** What checking a recipe found: it ready to make, or why not; and walls to check either way. */
export type Checked = {
  readonly recipe: CheckedRecipe | null;
  readonly findings: readonly Finding[];
};

const FACE_WORDS: Readonly<Record<Face, string>> = {
  top: "top",
  bottom: "bottom",
  front: "front",
  back: "back",
  left: "left side",
  right: "right side",
};

/** Whether a rectangle is on its face, and, when not, the reason in a line. */
const offFace = (rect: Rect, frame: FaceFrame, what: string, face: Face) => {
  const width = rect.u1 - rect.u0;
  const height = rect.v1 - rect.v0;
  if (width > frame.U || height > frame.V) {
    return `${what} is bigger than the ${FACE_WORDS[face]} it's on: ${round(width)} × ${round(height)} mm on a face of ${round(frame.U)} × ${round(frame.V)} mm.`;
  }
  if (rect.u0 < 0 || rect.v0 < 0 || rect.u1 > frame.U || rect.v1 > frame.V) {
    return `${what} runs off the ${FACE_WORDS[face]}: move it in, the face is ${round(frame.U)} × ${round(frame.V)} mm.`;
  }
  return undefined;
};

/**
 * Checks a recipe against the printer: every feature known, every hole and slot on its face,
 * every pocket in the part (open only where it says), fillets and chamfers that fit, and the
 * walls the pockets leave no thinner than two lines of the nozzle.
 */
export const checkRecipe = (recipe: PartRecipe, printer: PrinterSpec): Checked => {
  const clearance = printer.clearance.value;
  const least = round(2 * printer.nozzle.value);
  const { base } = recipe;
  const problems: string[] = [];
  const findings: Finding[] = [];
  const features: PartFeature[] = [];
  const box = baseBox(base);

  if ((base.kind === "plate" || base.kind === "l-bracket") && base.thickness < least) {
    const where = base.kind === "plate" ? "The plate" : "The L-bracket";
    findings.push({ kind: "wall-too-thin", where, mm: base.thickness, least });
  }
  if (
    base.kind === "l-bracket" &&
    (base.thickness >= base.depth || base.thickness >= base.height)
  ) {
    problems.push("The L-bracket is thicker than its legs are long: make its legs longer.");
  }

  recipe.features.forEach((raw, index) => {
    const parsed = PartFeature.safeParse(raw);
    const number = index + 1;
    if (!parsed.success) {
      const known = PART_FEATURES.includes(raw.kind as (typeof PART_FEATURES)[number]);
      problems.push(
        known
          ? `Feature ${number} (${raw.kind}) isn't written as one: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}.`
          : `Feature ${number} is a ${raw.kind}, which no recipe knows: use ${PART_FEATURES.join(", ")}.`,
      );
      return;
    }
    const feature = parsed.data;
    features.push(feature);
    switch (feature.kind) {
      case "hole": {
        const frame = faceFrame(base, feature.face);
        const dia = feature.countersunk
          ? headDiameter(feature.screw.diameter.value, clearance)
          : holeDiameter(feature.screw.diameter.value, clearance);
        const { u, v } = feature.at;
        const off = offFace(
          { u0: u - dia / 2, u1: u + dia / 2, v0: v - dia / 2, v1: v + dia / 2 },
          frame,
          `The hole for the ${feature.screw.name} (${round(dia)} mm${feature.countersunk ? " across its countersink" : ""})`,
          feature.face,
        );
        if (off) problems.push(off);
        return;
      }
      case "slot": {
        const frame = faceFrame(base, feature.face);
        const width = holeDiameter(feature.screw.diameter.value, clearance);
        const { u, v } = feature.at;
        if (feature.length < width) {
          problems.push(
            `The slot for the ${feature.screw.name} is shorter than it is wide: make it at least ${round(width)} mm long.`,
          );
          return;
        }
        const off = offFace(
          {
            u0: u - feature.length / 2,
            u1: u + feature.length / 2,
            v0: v - width / 2,
            v1: v + width / 2,
          },
          frame,
          `The slot for the ${feature.screw.name}`,
          feature.face,
        );
        if (off) problems.push(off);
        return;
      }
      case "pocket": {
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
        const rect = {
          u0: at.u - size.width / 2,
          u1: at.u + size.width / 2,
          v0: at.v - size.height / 2,
          v1: at.v + size.height / 2,
        };
        const what = `The pocket for the ${feature.object.name}`;
        const open = new Set(feature.open);
        const runsOut = [
          ...(rect.u0 < 0 && !open.has("left") ? ["left"] : []),
          ...(rect.u1 > frame.U && !open.has("right") ? ["right"] : []),
          ...(rect.v0 < 0 && !open.has("down") ? ["down"] : []),
          ...(rect.v1 > frame.V && !open.has("up") ? ["up"] : []),
        ];
        if (runsOut.length > 0) {
          problems.push(
            `${what} (${round(size.width)} × ${round(size.height)} mm with its clearance) runs out of the ${FACE_WORDS[feature.face]} ${runsOut.join(" and ")}: make the part bigger, or say it's open that way.`,
          );
          return;
        }
        if (size.depth >= frame.D) {
          problems.push(
            `${what} is ${round(size.depth)} mm deep with its clearance, as deep as the part or more (${round(frame.D)} mm): make the part deeper.`,
          );
          return;
        }
        const walls = [
          { where: "left of", mm: rect.u0, side: "left" },
          { where: "right of", mm: frame.U - rect.u1, side: "right" },
          { where: "below", mm: rect.v0, side: "down" },
          { where: "above", mm: frame.V - rect.v1, side: "up" },
          { where: "behind", mm: frame.D - size.depth, side: undefined },
        ] as const;
        for (const wall of walls) {
          if (wall.side !== undefined && open.has(wall.side)) continue;
          if (wall.mm < least) {
            findings.push({
              kind: "wall-too-thin",
              where: `The wall ${wall.where} the ${feature.object.name}`,
              mm: round(wall.mm),
              least,
            });
          }
        }
        return;
      }
      case "fillet":
      case "chamfer": {
        const name = feature.kind === "fillet" ? "A fillet" : "A chamfer";
        const mm = feature.kind === "fillet" ? feature.radius : feature.size;
        if (base.kind === "cylinder") {
          problems.push(`${name} rounds a base's upright corners, and a cylinder has none.`);
        } else if (mm * 2 >= Math.min(box.w, box.d)) {
          // At exactly half, the rounded outline closes up to nothing, and so does the part.
          problems.push(
            `${name} of ${mm} mm is half the part's ${round(Math.min(box.w, box.d))} mm or more: make it smaller.`,
          );
        }
        return;
      }
      case "text": {
        const frame = faceFrame(base, feature.face);
        if (feature.size > frame.V) {
          problems.push(
            `The lettering "${feature.text}" is taller than the ${FACE_WORDS[feature.face]} it's on (${round(frame.V)} mm).`,
          );
        } else if (feature.style === "cut" && feature.depth >= frame.D) {
          problems.push(
            `The lettering "${feature.text}" is cut deeper than the part is thick (${round(frame.D)} mm).`,
          );
        }
        return;
      }
    }
  });

  if (problems.length > 0) {
    return { recipe: null, findings: [{ kind: "cannot-make", problems }, ...findings] };
  }
  return { recipe: { base, features, clearance, least }, findings };
};

/**
 * The part's size once made, mm: its base's box, and lettering raised on a face standing out from
 * it. Nothing else adds to a part; everything else cuts into it.
 */
export const envelopeOf = (recipe: Pick<CheckedRecipe, "base" | "features">) => {
  const { w, d, h } = baseBox(recipe.base);
  // Two raised on one face stand out as far as the deeper.
  const standing = new Map<Face, number>();
  for (const feature of recipe.features) {
    if (feature.kind !== "text" || feature.style !== "raised") continue;
    standing.set(feature.face, Math.max(standing.get(feature.face) ?? 0, feature.depth));
  }
  const out = (faces: readonly Face[]) =>
    faces.reduce((sum, face) => sum + (standing.get(face) ?? 0), 0);
  return {
    length: round(w + out(["left", "right"])),
    depth: round(d + out(["front", "back"])),
    height: round(h + out(["top", "bottom"])),
  };
};
