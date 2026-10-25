/// <reference path="./opentype.d.ts" />
import opentype, { type Font } from "opentype.js";

// Lettering (#702): a line of text as flat outlines, in mm, for a part to raise or cut. Set in the
// bundled Figtree Bold (`font/`, SIL Open Font License), so it's the same on every machine.

/** Where the bundled font is from the package's folder, for whoever reads files to load it. */
export const FONT_FILE = "print/font/figtree-bold.ttf";

/** How many straight lines each curve of a letter becomes. */
const CURVE_STEPS = 6;

/** The font, read from its file's bytes. */
export const readFont = (bytes: ArrayBuffer): Font => opentype.parse(bytes);

type Point = [number, number];

/** A point along a curve from `p0` through the control points to `p3`, `t` of the way. */
const along = (points: readonly Point[], t: number): Point => {
  let level = points;
  while (level.length > 1) {
    level = level.slice(1).map(([x, y], index): Point => {
      const [px, py] = level[index] ?? [x, y];
      return [px + (x - px) * t, py + (y - py) * t];
    });
  }
  return level[0] ?? [0, 0];
};

/**
 * A line of text as closed outlines, `y` up, its capitals `size` mm tall, centred on (0, 0) by
 * its outlines' box, and that box's size.
 */
export const outlinesOf = (font: Font, text: string, size: number) => {
  const capHeight = font.tables.os2?.sCapHeight ?? font.unitsPerEm * 0.7;
  const fontSize = (size * font.unitsPerEm) / capHeight;
  // In the font's own way round, `y` down, until the end.
  const contours: Point[][] = [];
  let contour: Point[] = [];
  const close = () => {
    if (contour.length >= 3) contours.push(contour);
    contour = [];
  };
  const curve = (controls: readonly Point[]) => {
    const from = contour.at(-1) ?? [0, 0];
    for (let step = 1; step <= CURVE_STEPS; step += 1) {
      contour.push(along([from, ...controls], step / CURVE_STEPS));
    }
  };
  for (const command of font.getPath(text, 0, 0, fontSize).commands) {
    switch (command.type) {
      case "M":
        close();
        contour.push([command.x, command.y]);
        break;
      case "L":
        contour.push([command.x, command.y]);
        break;
      case "Q":
        curve([
          [command.x1, command.y1],
          [command.x, command.y],
        ]);
        break;
      case "C":
        curve([
          [command.x1, command.y1],
          [command.x2, command.y2],
          [command.x, command.y],
        ]);
        break;
      case "Z":
        close();
        break;
    }
  }
  close();
  const points = contours.flat();
  if (points.length === 0) return { contours: [], width: 0, height: 0 };
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [left, right, top, bottom] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const [midX, midY] = [(left + right) / 2, (top + bottom) / 2];
  return {
    contours: contours.map((each) => each.map(([x, y]): Point => [x - midX, midY - y])),
    width: right - left,
    height: bottom - top,
  };
};
