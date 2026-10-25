import type { DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  anchorOf,
  type BuildScene,
  drawMark,
  hatching,
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
/**
 * How far the camera starts from what it turns about, in the scene's reach: the whole Build, or
 * closer for a step's scene, whose long lengths would otherwise sit small in the middle.
 */
const DISTANCE = { whole: 2.3, step: 1.8 } as const;

/**
 * The parts with a letter over them: those lit at the step, or every part when none is, one
 * letter a part so they don't pile up (#753).
 */
const letteredOf = (scene: BuildScene) => {
  const anyLit = scene.pieces.some((piece) => piece.tone === "lit");
  return scene.pieces.flatMap((piece) =>
    piece.kind === "part" && piece.label !== null && (!anyLit || piece.tone === "lit")
      ? [{ label: piece.label, name: piece.name, lit: piece.tone === "lit" }]
      : [],
  );
};

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
}) {
  const { derived, lit } = props;
  const host = useRef<HTMLElement>(null);
  const labels = useRef(new Map<string, HTMLElement>());
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
  const atStep = props.scene !== undefined;
  const [drawn, setDrawn] = useState({ scene: wanted, id: props.sceneId, atStep, shape });
  if (drawn.shape !== shape) setDrawn({ scene: wanted, id: props.sceneId, atStep, shape });
  const { scene: built, id: builtId, atStep: builtAtStep } = drawn;
  // Where the camera was, in the scene's reach, and for which picture.
  const kept = useRef<{ id: string; offset: THREE.Vector3 }>(undefined);

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
    const distance = builtAtStep ? DISTANCE.step : DISTANCE.whole;
    const start = () => viewFrom(built.view, reach * distance);
    camera.position.copy(
      kept.current?.id === builtId ? kept.current.offset.clone().multiplyScalar(reach) : start(),
    );
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
    controls.minDistance = reach * 1.1;
    controls.maxDistance = reach * 4;
    // Polar angles run down from straight above: never flat on top, never under the floor.
    controls.minPolarAngle = ((90 - TILT.most) * Math.PI) / 180;
    controls.maxPolarAngle = ((90 - TILT.least) * Math.PI) / 180;

    const anchors = [
      ...letteredOf(built).map(({ label }) => {
        const box = built.pieces.find((piece) => piece.label === label)?.boxes[0];
        return { key: `part ${label}`, at: box === undefined ? undefined : centreOf(box) };
      }),
      ...built.marks.map((mark, at) => ({ key: `mark ${at}`, at: point(anchorOf(mark)) })),
    ];
    const draw = () => {
      renderer.render(world, camera);
      const { clientWidth: width, clientHeight: height } = element;
      const view = viewOf(camera.position.clone().sub(controls.target));
      element.dataset.turn = String(view.turn);
      element.dataset.tilt = String(view.tilt);
      for (const { key, at } of anchors) {
        const label = labels.current.get(key);
        if (label === undefined || at === undefined) continue;
        const onScreen = at.clone().project(camera);
        // Kept inside the picture, so words near its edge aren't cut off.
        const half = label.offsetWidth / 2;
        const x = Math.min(Math.max(((onScreen.x + 1) / 2) * width, half), width - half);
        label.style.transform = `translate(${x}px, ${((1 - onScreen.y) / 2) * height}px) translate(-50%, -50%)`;
      }
    };
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
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
        camera.position.copy(start());
        controls.update();
      },
    };
    scene.current.light(litNow.current);

    return () => {
      scene.current = undefined;
      kept.current = {
        id: builtId,
        offset: camera.position.clone().sub(controls.target).divideScalar(reach),
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
  }, [built, builtId, builtAtStep]);

  useEffect(() => scene.current?.light(lit), [lit]);

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
      className="relative h-full w-full touch-none overflow-hidden select-none"
    >
      {props.scene !== undefined && (
        <CapsLabel tone="muted" className="pointer-events-none absolute top-0 left-0">
          {built.title}
        </CapsLabel>
      )}
      {built.marks.map((mark, at) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks are in a fixed order.
          key={at}
          ref={place(`mark ${at}`)}
          className={classes(
            "pointer-events-none absolute top-0 left-0 rounded-sm px-1 text-caption whitespace-nowrap",
            mark.kind === "size" &&
              "border border-warning/60 bg-background/80 font-mono text-warning",
            mark.kind === "check" && "bg-background/80 font-mono text-success",
            mark.kind === "line" && "font-mono text-foreground",
            mark.kind === "arrow" && "text-primary-text",
            mark.kind === "note" &&
              (mark.tone === "waste"
                ? "text-destructive-text"
                : mark.tone === "check"
                  ? "text-success"
                  : "text-muted-foreground"),
          )}
        >
          {markWords(mark)}
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
            "absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border-2 font-mono text-caption font-bold",
            lit === part.label || part.lit
              ? "border-primary-text bg-primary text-primary-foreground"
              : "border-primary bg-background text-foreground",
          )}
        >
          {part.label}
        </button>
      ))}
      <div className="absolute right-0 bottom-0">
        <Button variant="outline" size="md" onClick={() => scene.current?.reset()}>
          <RotateCcw aria-hidden />
          Reset view
        </Button>
      </div>
    </figure>
  );
}
