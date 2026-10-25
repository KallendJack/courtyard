import type { BuildBox, BuildStep, DerivedBuild } from "@courtyard/contract";
import * as THREE from "three";

// What the 3D view draws a step's scene with (#754): where the camera goes, how far it may turn,
// the marks over the scene and the waste side's hatching. Only `bench-view.tsx` imports it, so
// `three` stays in the 3D view's own file.

export type BuildScene = BuildStep["scene"];
type BuildSceneMark = BuildScene["marks"][number];
type At = { x: number; y: number; z: number };

/** A colour by its name in the theme (packages/ui/theme.css), since a 3D scene can't read classes. */
export const themed = (name: string) =>
  new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());

/** How far the camera may tilt, in degrees above level: never under the floor, never flat on top. */
export const TILT = { least: 15, most: 60 } as const;

const RADIANS = Math.PI / 180;

/** The whole Build as a scene, when no step is showing: every part and what's fitted, plain. */
export const wholeScene = (derived: DerivedBuild): BuildScene => ({
  title: "The finished bench",
  view: { turn: -35, tilt: 25 },
  pieces: [
    ...derived.parts.map((part) => ({
      kind: "part" as const,
      name: part.name,
      label: part.label,
      tone: "plain" as const,
      boxes: part.boxes,
    })),
    ...derived.fitted.map((each) => ({
      kind: "fitted" as const,
      name: each.name,
      label: null,
      tone: "plain" as const,
      boxes: each.boxes,
    })),
  ],
  marks: [],
});

/**
 * Where the scene's points sit in three: the engine's `x` along, `y` back from the front and `z`
 * up, centred on everything drawn, with three's `y` up and its `z` towards the viewer.
 */
export const placing = (scene: BuildScene) => {
  const boxes = scene.pieces.flatMap((piece) => piece.boxes);
  const least = (pick: (box: BuildBox) => number) => Math.min(...boxes.map(pick));
  const most = (pick: (box: BuildBox) => number) => Math.max(...boxes.map(pick));
  const from = { x: least((b) => b.x), y: least((b) => b.y), z: least((b) => b.z) };
  const to = { x: most((b) => b.x + b.w), y: most((b) => b.y + b.d), z: most((b) => b.z + b.h) };
  const centre = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
  const point = (at: At) => new THREE.Vector3(at.x - centre.x, at.z - centre.z, centre.y - at.y);
  return {
    point,
    centreOf: (box: BuildBox) =>
      point({ x: box.x + box.w / 2, y: box.y + box.d / 2, z: box.z + box.h / 2 }),
    reach: Math.max(to.x - from.x, to.y - from.y, to.z - from.z, 1),
  };
};

/** The camera at a scene's view, the given distance from what it turns about. */
export const viewFrom = (view: BuildScene["view"], distance: number) => {
  const turn = view.turn * RADIANS;
  const tilt = Math.min(Math.max(view.tilt, TILT.least), TILT.most) * RADIANS;
  return new THREE.Vector3(
    Math.sin(turn) * Math.cos(tilt),
    Math.sin(tilt),
    Math.cos(turn) * Math.cos(tilt),
  ).multiplyScalar(distance);
};

/** Where the camera is now, as a view: turned from the front and up from level, in degrees. */
export const viewOf = (offset: THREE.Vector3): BuildScene["view"] => ({
  turn: Math.round(Math.atan2(offset.x, offset.z) / RADIANS),
  tilt: Math.round(Math.asin(offset.y / offset.length()) / RADIANS),
});

/** Diagonal stripes over the timber, for the waste side. */
export const hatching = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const pen = canvas.getContext("2d");
  if (pen !== null) {
    pen.fillStyle = `#${themed("timber").getHexString()}`;
    pen.fillRect(0, 0, 64, 64);
    pen.strokeStyle = `#${themed("destructive").getHexString()}`;
    pen.lineWidth = 6;
    for (let at = -64; at < 128; at += 16) {
      pen.beginPath();
      pen.moveTo(at, 64);
      pen.lineTo(at + 64, 0);
      pen.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // A box's face takes the whole texture once, so an offcut's long faces repeat it to show stripes.
  texture.repeat.set(10, 1);
  return texture;
};

/** Each mark's colour by the theme: sizes gold as the board has them, the saw violet, checks moss. */
const MARK_COLOUR: Readonly<Record<BuildSceneMark["kind"], string>> = {
  size: "warning",
  line: "foreground",
  arrow: "primary",
  check: "success",
  note: "muted-foreground",
};

/** Where a mark's words go: a line's middle, an arrow's tail, a note's place. */
export const anchorOf = (mark: BuildSceneMark): At => {
  if (mark.kind === "note") return mark.at;
  if (mark.kind === "arrow") return mark.from;
  if (mark.kind === "line") return mark.to;
  return {
    x: (mark.from.x + mark.to.x) / 2,
    y: (mark.from.y + mark.to.y) / 2,
    z: (mark.from.z + mark.to.z) / 2,
  };
};

/** What a mark says: a size or check by its whole mm, the others in their own words. */
export const markWords = (mark: BuildSceneMark) =>
  mark.kind === "size" || mark.kind === "check" ? String(Math.round(mark.mm)) : mark.says;

/**
 * A mark's lines in the scene: a dashed dimension or check, a pencil line, an arrow with its head.
 * Notes are words only. Returns what to dispose of.
 */
export const drawMark = (
  world: THREE.Scene,
  mark: BuildSceneMark,
  point: (at: At) => THREE.Vector3,
  reach: number,
) => {
  if (mark.kind === "note") return [];
  const colour = themed(MARK_COLOUR[mark.kind]);
  const from = point(mark.from);
  const to = point(mark.to);
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const dashed = mark.kind === "size" || mark.kind === "check";
  const material = dashed
    ? new THREE.LineDashedMaterial({ color: colour, dashSize: reach / 80, gapSize: reach / 120 })
    : new THREE.LineBasicMaterial({ color: colour });
  const line = new THREE.Line(geometry, material);
  if (dashed) line.computeLineDistances();
  world.add(line);
  if (mark.kind !== "arrow") return [geometry, material];
  const head = new THREE.ConeGeometry(reach / 90, reach / 30, 12);
  const headMaterial = new THREE.MeshBasicMaterial({ color: colour });
  const cone = new THREE.Mesh(head, headMaterial);
  const along = to.clone().sub(from).normalize();
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
  cone.position.copy(to.clone().sub(along.multiplyScalar(reach / 60)));
  world.add(cone);
  return [geometry, material, head, headMaterial];
};
