import type { DerivedBuild } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CALLOUT_FILL, isSmall, outlineOf, placeWords } from "./picture/callouts.ts";
import {
  anchorOf,
  type BuildScene,
  drawMark,
  hatching,
  letteredOf,
  markClass,
  markWords,
  placing,
  TILT,
  themed,
  viewFrom,
  viewOf,
  wholeScene,
} from "./scene.ts";

// The Build in 3D (#698), and at a step the job as it's done (#754): the scene's pieces as boxes,
// turnable within limits, its marks drawn over it, each part lit at the step labelled. Loaded
// lazily (`bench-panel.tsx`), so `three` is in this view's own file and nowhere else.

const KIND_COLOUR: Readonly<Record<"timber" | "sheet" | "printed", string>> = {
  timber: "timber",
  sheet: "sheet",
  printed: "printed",
};

/** How far a press may move and still be a tap on a part, not a turn, in pixels. */
const TAP_SLOP = 6;

/** How much of the view's shorter half the scene reaches, from its middle, once fitted (#753). */
const FILL = 0.9;

/**
 * The scene, drawn when something changes it (a turn, a part lit, a new step), never in a loop.
 * The part letters and the marks' words are over the canvas, moved to where each belongs. Built
 * again only when the scene's numbers change: at the same step it stays as the owner turned it,
 * and a new step opens at the angle that best shows it.
 */
export default function BenchView(props: {
  derived: DerivedBuild;
  lit: string | undefined;
  /** The step's scene (#754); the whole Build when no step is showing. */
  scene: BuildScene | undefined;
  /** Which picture it is (a step's ID): the camera is kept only while it's the same. */
  sceneId: string;
  pick: (label: string) => void;
  /** Changes when Reset view is tapped. */
  reset: number;
  /** Whether the marks' words are at the bench's size, as the step beside it is. */
  big: boolean;
}) {
  const { derived, lit, reset } = props;
  const host = useRef<HTMLElement>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const leaders = useRef(new Map<string, SVGLineElement>());
  const scene = useRef<{ light: (label: string | undefined) => void; reset: () => void }>(
    undefined,
  );
  const pick = useRef(props.pick);
  pick.current = props.pick;
  const litNow = useRef(lit);
  litNow.current = lit;
  const [cantDraw, setCantDraw] = useState(false);
  const wanted = props.scene ?? wholeScene(derived);
  const shape = `${props.sceneId} ${JSON.stringify(wanted)}`;
  const [drawn, setDrawn] = useState({ scene: wanted, id: props.sceneId, shape });
  if (drawn.shape !== shape) setDrawn({ scene: wanted, id: props.sceneId, shape });
  const { scene: built, id: builtId } = drawn;
  // Which way the camera looked, and at which picture: kept only while it's the same.
  const kept = useRef<{ id: string; from: THREE.Vector3 }>(undefined);

  // The parts' materials, read when the scene is built: the Build is read again every 30 seconds
  // as a new object, and only new numbers build the scene again.
  const parts = useRef(derived.parts);
  parts.current = derived.parts;
  const lettered = letteredOf(built);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setCantDraw(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.prepend(renderer.domElement);

    const { point, centreOf, reach } = placing(built);
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, reach / 20, reach * 20);
    // The way the scene looks best, at first and after Reset view; how far away is fitted.
    const start = () => viewFrom(built.view, 1).normalize();
    camera.position.copy(kept.current?.id === builtId ? kept.current.from : start());
    // Every face lit, so no side turns black: an even fill, the sky and floor, and a key light.
    world.add(new THREE.AmbientLight(0xffffff, 1.1));
    world.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(-reach, reach * 2, reach * 1.5);
    world.add(key);

    const edges = new THREE.LineBasicMaterial({
      color: themed("background"),
      opacity: 0.45,
      transparent: true,
    });
    const glow = themed("primary");
    const hatch = hatching();
    const tool = themed("fitted");
    const meshes: {
      label: string | null;
      colour: THREE.Color;
      tone: BuildScene["pieces"][number]["tone"];
      mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    }[] = [];
    for (const piece of built.pieces) {
      const part = parts.current.find((each) => each.label === piece.label);
      const colour =
        piece.kind === "part" && part !== undefined
          ? themed(KIND_COLOUR[part.material.kind])
          : piece.kind === "offcut"
            ? new THREE.Color(0xffffff)
            : tool;
      for (const box of piece.boxes) {
        const geometry = new THREE.BoxGeometry(box.w, box.h, box.d);
        const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 });
        if (piece.kind === "offcut") material.map = hatch;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(centreOf(box));
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edges));
        world.add(mesh);
        meshes.push({ label: piece.label, colour, tone: piece.tone, mesh });
      }
    }
    const marked = built.marks.flatMap((mark) => drawMark(world, mark, point, reach));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    // Polar angles run down from straight above: never flat on top, never under the floor.
    controls.minPolarAngle = ((90 - TILT.most) * Math.PI) / 180;
    controls.maxPolarAngle = ((90 - TILT.least) * Math.PI) / 180;

    const letters = letteredOf(built).map(({ label }) => {
      const box = built.pieces.find((piece) => piece.label === label)?.boxes[0];
      return { key: `part ${label}`, at: box === undefined ? undefined : centreOf(box) };
    });
    const anchored = built.marks.map((mark, at) => ({
      key: `mark ${at}`,
      at: point(anchorOf(mark)),
      callout: mark.kind === "callout",
    }));
    const marks = anchored.filter((mark) => !mark.callout);
    const callouts = anchored.filter((mark) => mark.callout);
    const draw = () => {
      renderer.render(world, camera);
      const { clientWidth: width, clientHeight: height } = element;
      const view = viewOf(camera.position.clone().sub(controls.target));
      element.dataset.turn = String(view.turn);
      element.dataset.tilt = String(view.tilt);
      element.toggleAttribute("data-small", isSmall({ width, height }));
      const onScreen = (at: THREE.Vector3) => {
        const projected = at.clone().project(camera);
        return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height };
      };
      const measured = (key: string, at: THREE.Vector3 | undefined) => {
        const label = labels.current.get(key);
        if (label === undefined || at === undefined) return [];
        const leader = leaders.current.get(key);
        return [{ label, leader, ...onScreen(at), w: label.offsetWidth, h: label.offsetHeight }];
      };
      placeWords({
        shown: [...marks, ...letters].flatMap(({ key, at }) => measured(key, at)),
        callouts: callouts.flatMap(({ key, at }) => measured(key, at)),
        outlines: meshes.map(({ mesh }) => outlineOf(mesh, onScreen)),
        bounds: { width, height },
      });
    };
    /**
     * Turns the camera to look from `from` (else as it looks now) at the scene, near enough that
     * it fills the view: moved in or out until its farthest corner is at `FILL`.
     */
    const fit = (from?: THREE.Vector3) => {
      const fill = built.marks.some((mark) => mark.kind === "callout") ? CALLOUT_FILL : FILL;
      const shown = new THREE.Box3();
      for (const { mesh } of meshes) shown.expandByObject(mesh);
      if (shown.isEmpty()) return;
      const direction = (from ?? camera.position.clone().sub(controls.target)).normalize();
      const centre = shown.getCenter(new THREE.Vector3());
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
        (corner) =>
          new THREE.Vector3(
            corner & 1 ? shown.max.x : shown.min.x,
            corner & 2 ? shown.max.y : shown.min.y,
            corner & 4 ? shown.max.z : shown.min.z,
          ),
      );
      let distance = shown.getSize(new THREE.Vector3()).length() * 1.5;
      // Nearly in proportion, so a few rounds settle it.
      for (let round = 0; round < 5; round += 1) {
        camera.position.copy(direction).multiplyScalar(distance).add(centre);
        camera.lookAt(centre);
        camera.updateMatrixWorld();
        const reaches = Math.max(
          ...corners.map((corner) => {
            const onScreen = corner.clone().project(camera);
            return Math.max(Math.abs(onScreen.x), Math.abs(onScreen.y));
          }),
        );
        if (reaches > 0) distance *= reaches / fill;
      }
      controls.target.copy(centre);
      camera.position.copy(direction).multiplyScalar(distance).add(centre);
      controls.minDistance = distance * 0.4;
      controls.maxDistance = distance * 3;
      controls.update();
    };

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fit();
      draw();
    };
    controls.addEventListener("change", draw);
    controls.update();
    const watch = new ResizeObserver(resize);
    watch.observe(element);

    // A tap, not a turn, on a part lights it and opens its card.
    let down: { x: number; y: number } | undefined;
    const pressed = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const released = (event: PointerEvent) => {
      if (down === undefined) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = undefined;
      if (moved > TAP_SLOP) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(
        meshes.map(({ mesh }) => mesh),
        false,
      )[0];
      const label = meshes.find(({ mesh }) => mesh === hit?.object)?.label;
      if (label !== undefined && label !== null) pick.current(label);
    };
    renderer.domElement.addEventListener("pointerdown", pressed);
    renderer.domElement.addEventListener("pointerup", released);

    scene.current = {
      // The step's own parts are violet, those put on before faint; the part whose card is open
      // glows either way.
      light: (label) => {
        for (const each of meshes) {
          const { mesh } = each;
          mesh.material.color.copy(each.tone === "lit" ? glow : each.colour);
          mesh.material.transparent = each.tone === "built";
          mesh.material.opacity = each.tone === "built" ? 0.35 : 1;
          mesh.material.emissive.copy(
            each.label !== null && each.label === label ? glow : new THREE.Color(0),
          );
          mesh.material.emissiveIntensity = 0.35;
        }
        draw();
      },
      reset: () => {
        fit(start());
        draw();
      },
    };
    scene.current.light(litNow.current);

    return () => {
      scene.current = undefined;
      kept.current = {
        id: builtId,
        from: camera.position.clone().sub(controls.target).normalize(),
      };
      watch.disconnect();
      controls.dispose();
      for (const { mesh } of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      for (const each of marked) each.dispose();
      hatch.dispose();
      edges.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [built, builtId]);

  useEffect(() => scene.current?.light(lit), [lit]);
  useEffect(() => {
    if (reset > 0) scene.current?.reset();
  }, [reset]);

  const place = (key: string) => (element: HTMLElement | null) => {
    if (element === null) labels.current.delete(key);
    else labels.current.set(key, element);
  };

  if (cantDraw) {
    return (
      <p className="flex h-full items-center justify-center px-6 text-center text-meta text-muted-foreground">
        This browser can't draw the Build in 3D. The cut plan and the buy list still work.
      </p>
    );
  }
  return (
    <figure
      ref={host}
      aria-label={`${built.title}, in 3D`}
      className="group relative h-full w-full touch-none overflow-hidden select-none"
    >
      {props.scene !== undefined && (
        <CapsLabel tone="muted" className="pointer-events-none absolute top-0 left-0">
          {built.title}
        </CapsLabel>
      )}
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
        {built.marks.map((mark, at) =>
          mark.kind === "callout" ? (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks are in a fixed order.
              key={at}
              ref={(line) => {
                if (line === null) leaders.current.delete(`mark ${at}`);
                else leaders.current.set(`mark ${at}`, line);
              }}
              strokeWidth={1.5}
              className={mark.tone === "yours" ? "stroke-yours" : "stroke-success"}
            />
          ) : null,
        )}
      </svg>
      {built.marks.map((mark, at) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks are in a fixed order.
          key={at}
          ref={place(`mark ${at}`)}
          className={classes(
            "pointer-events-none absolute top-0 left-0 rounded-sm px-1 whitespace-nowrap",
            markClass(mark, props.big),
          )}
        >
          {mark.kind === "callout" ? (
            <>
              <span className="block font-semibold">{mark.says}</span>
              {mark.more !== undefined && (
                <span className="block group-data-small:hidden">{mark.more}</span>
              )}
            </>
          ) : (
            markWords(mark)
          )}
        </span>
      ))}
      {lettered.map((part) => (
        <button
          key={part.label}
          ref={place(`part ${part.label}`)}
          type="button"
          aria-label={`${part.label}, ${part.name}`}
          aria-pressed={lit === part.label}
          aria-current={part.lit ? "step" : undefined}
          onClick={() => props.pick(part.label)}
          className={classes(
            "absolute top-0 left-0 flex size-8 items-center justify-center rounded-full border-2 font-mono text-meta font-bold",
            lit === part.label || part.lit
              ? "border-primary-text bg-primary text-primary-foreground"
              : "border-primary bg-background text-foreground",
          )}
        >
          {part.label}
        </button>
      ))}
    </figure>
  );
}
