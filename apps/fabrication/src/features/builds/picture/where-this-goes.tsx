import type { BuildBox, BuildStep, DerivedBuild } from "@courtyard/contract";
import { IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { X } from "lucide-react";
import { useState } from "react";
import { listed } from "../words.ts";

// Where this step's pieces go on the finished Build (#826; Paper, 2 · Agreed, "Fabrication · End
// frames in 3D, your kit · Fold (#785, #788)"): a small drawing of the whole Build over the
// picture's corner, this step's pieces vivid and the rest outlined; a tap shows it big. Drawn flat
// from the parts' boxes, so it needs no second 3D view.

type Point = { x: number; y: number };
type At = { x: number; y: number; z: number };

const COS = Math.cos(Math.PI / 6);

/** Where a point lands, seen from above the front right corner. */
const flat = (at: At): Point => ({ x: (at.x - at.y) * COS, y: (at.x + at.y) / 2 - at.z });

/** A box's three faces seen from that corner: its top, its right end and its front. */
const facesOf = (b: BuildBox): Point[][] => {
  const top = b.z + b.h;
  const right = b.x + b.w;
  const near = b.y + b.d;
  return [
    [
      { x: b.x, y: b.y, z: top },
      { x: right, y: b.y, z: top },
      { x: right, y: near, z: top },
      { x: b.x, y: near, z: top },
    ],
    [
      { x: right, y: b.y, z: top },
      { x: right, y: near, z: top },
      { x: right, y: near, z: b.z },
      { x: right, y: b.y, z: b.z },
    ],
    [
      { x: b.x, y: near, z: top },
      { x: right, y: near, z: top },
      { x: right, y: near, z: b.z },
      { x: b.x, y: near, z: b.z },
    ],
  ].map((face) => face.map(flat));
};

/** The whole Build drawn flat, this step's parts filled violet and the rest outlined. */
function Drawing(props: { derived: DerivedBuild; step: BuildStep; className: string }) {
  const lit = new Set(props.step.parts);
  const boxes = props.derived.parts
    .flatMap((part) => part.boxes.map((box) => ({ box, lit: lit.has(part.label) })))
    // Far to near, so a nearer box is drawn over one behind it.
    .sort(
      (a, b) =>
        a.box.x +
        a.box.y +
        a.box.w / 2 +
        a.box.d / 2 -
        (b.box.x + b.box.y + b.box.w / 2 + b.box.d / 2),
    );
  const points = boxes.flatMap(({ box }) => facesOf(box).flat());
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const width = Math.max(...points.map((point) => point.x)) - left;
  const height = Math.max(...points.map((point) => point.y)) - top;
  return (
    <svg
      aria-hidden
      viewBox={`${left} ${top} ${width} ${height}`}
      className={props.className}
      preserveAspectRatio="xMidYMid meet"
    >
      {boxes.map(({ box, lit: vivid }) =>
        facesOf(box).map((face, side) => (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: a box's faces are in a fixed order.
            key={`${box.x} ${box.y} ${box.z} ${side}`}
            points={face.map((point) => `${point.x},${point.y}`).join(" ")}
            className={classes(
              vivid
                ? side === 0
                  ? "fill-primary stroke-primary-text"
                  : "fill-primary/70 stroke-primary-text"
                : "fill-none stroke-muted-foreground/60",
            )}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
    </svg>
  );
}

export function WhereThisGoes(props: { derived: DerivedBuild; step: BuildStep }) {
  const [big, setBig] = useState(false);
  const names = props.derived.parts
    .filter((part) => props.step.parts.includes(part.label))
    .map((part) => part.name.toLowerCase());
  if (names.length === 0) return null;
  const what = listed(names);
  const says = `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
  return big ? (
    <section
      aria-label="Where this goes"
      className="absolute inset-0 z-10 flex flex-col gap-2 rounded-row border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <CapsLabel tone="muted" heading={{ level: 3 }}>
          Where this goes
        </CapsLabel>
        <IconButton label="Close" icon={<X aria-hidden />} onClick={() => setBig(false)} />
      </div>
      <Drawing derived={props.derived} step={props.step} className="min-h-0 w-full flex-1" />
      <p className="text-meta text-primary-text">{says}</p>
    </section>
  ) : (
    <button
      type="button"
      aria-label={`Where this goes: ${says}. Show it big`}
      onClick={() => setBig(true)}
      className="absolute top-0 right-0 z-10 flex w-26 flex-col gap-1.5 rounded-row border border-border bg-surface/95 p-2 text-left"
    >
      <CapsLabel tone="muted">Where this goes</CapsLabel>
      <Drawing derived={props.derived} step={props.step} className="h-16 w-full" />
      <span className="text-label text-primary-text">{says} · tap</span>
    </button>
  );
}
