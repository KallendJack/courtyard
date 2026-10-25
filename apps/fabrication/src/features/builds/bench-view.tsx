import type { BuildBox, BuildPart, DerivedBuild } from "@courtyard/contract";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { InView } from "./progress.ts";

// The Build in 3D (#698): its parts as the engine's boxes, turnable, each part labelled. Loaded
// lazily (`bench-panel.tsx`), so `three` is in this view's own file and nowhere else.

/** A colour by its name in the theme (packages/ui/theme.css), since a 3D scene can't read classes. */
const themed = (name: string) =>
  new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());

const KIND_COLOUR: Readonly<Record<BuildPart["material"]["kind"], string>> = {
  timber: "timber",
  sheet: "sheet",
  printed: "printed",
};

/** How far a press may move and still be a tap on a part, not a turn, in pixels. */
const TAP_SLOP = 6;

/**
 * Where a box sits in the scene: the engine's `x` along, `y` back from the front and `z` up,
 * centred on the Build, with three's `y` up and its `z` towards the viewer.
 */
const centreOf = (box: BuildBox, size: DerivedBuild["size"]) =>
  new THREE.Vector3(
    box.x + box.w / 2 - size.length / 2,
    box.z + box.h / 2,
    size.depth / 2 - (box.y + box.d / 2),
  );

/**
 * What the scene is built from, as text to compare: the Build's size and every box, with each
 * part's letter and kind. The page asks for the Build again every 30 seconds and gets the same
 * numbers in a new object; only new numbers build the scene again.
 */
const shapeOf = (derived: DerivedBuild) =>
  JSON.stringify([
    derived.size,
    derived.parts.map((part) => [part.label, part.material.kind, part.boxes]),
    derived.fitted.map((each) => each.boxes),
  ]);

/**
 * The scene, drawn when something changes it (a turn, a part lit, a new size), never in a loop.
 * The part labels are buttons over the canvas, moved to where each part's first box is. Built
 * again only when the Build's numbers change, and then from where the owner had turned it.
 */
export default function BenchView(props: {
  derived: DerivedBuild;
  lit: string | undefined;
  /** At a step (#699): the parts put on so far, and the step's own, lit; else the whole Build. */
  view: InView | undefined;
  pick: (label: string) => void;
}) {
  const { derived, lit, view: atStep } = props;
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const scene = useRef<{
    draw: () => void;
    light: (label: string | undefined, view: InView | undefined) => void;
  }>(undefined);
  const pick = useRef(props.pick);
  pick.current = props.pick;
  const litNow = useRef({ lit, atStep });
  litNow.current = { lit, atStep };
  const [cantDraw, setCantDraw] = useState(false);
  const shape = shapeOf(derived);
  const [drawn, setDrawn] = useState({ derived, shape });
  if (drawn.shape !== shape) setDrawn({ derived, shape });
  const built = drawn.derived;
  // Where the camera was from what it turns about, in the Build's reach, for the next scene.
  const view = useRef<THREE.Vector3>(undefined);

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

    const { size } = built;
    const reach = Math.max(size.length, size.depth, size.height);
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, reach / 20, reach * 20);
    const target = new THREE.Vector3(0, size.height / 2.2, 0);
    camera.position.copy(
      view.current === undefined
        ? new THREE.Vector3(-1, 0.85, 1.35).normalize().multiplyScalar(reach * 2.3)
        : view.current.clone().multiplyScalar(reach).add(target),
    );
    world.add(new THREE.HemisphereLight(0xffffff, 0x202020, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-reach, reach * 2, reach * 1.5);
    world.add(sun);

    const edges = new THREE.LineBasicMaterial({
      color: themed("background"),
      opacity: 0.45,
      transparent: true,
    });
    const glow = themed("primary");
    const meshes: {
      /** The part's letter; none for something fitted. */
      label: string | undefined;
      /** The part it belongs with as the steps build it up: its own, or what it's fitted to. */
      with: string;
      colour: THREE.Color;
      mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    }[] = [];
    const add = (box: BuildBox, colour: THREE.Color, part: { label?: string; with: string }) => {
      const geometry = new THREE.BoxGeometry(box.w, box.h, box.d);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }),
      );
      mesh.position.copy(centreOf(box, size));
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edges));
      world.add(mesh);
      meshes.push({ label: part.label, with: part.with, colour, mesh });
    };
    for (const part of built.parts) {
      const colour = themed(KIND_COLOUR[part.material.kind]);
      for (const box of part.boxes) add(box, colour, { label: part.label, with: part.label });
    }
    const fitted = themed("fitted");
    for (const each of built.fitted) {
      for (const box of each.boxes) add(box, fitted, { with: each.on });
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enablePan = false;
    controls.minDistance = reach * 1.1;
    controls.maxDistance = reach * 4;

    const anchors = built.parts.map((part) => ({
      label: part.label,
      at: part.boxes[0] === undefined ? undefined : centreOf(part.boxes[0], size),
    }));
    const draw = () => {
      renderer.render(world, camera);
      const { clientWidth: width, clientHeight: height } = element;
      for (const { label, at } of anchors) {
        const button = labels.current.get(label);
        if (button === undefined || at === undefined) continue;
        const onScreen = at.clone().project(camera);
        button.style.transform = `translate(${((onScreen.x + 1) / 2) * width}px, ${((1 - onScreen.y) / 2) * height}px) translate(-50%, -50%)`;
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
        meshes.flatMap(({ mesh }) => (mesh.visible ? [mesh] : [])),
        false,
      )[0];
      const label = meshes.find(({ mesh }) => mesh === hit?.object)?.label;
      if (label !== undefined) pick.current(label);
    };
    renderer.domElement.addEventListener("pointerdown", pressed);
    renderer.domElement.addEventListener("pointerup", released);

    scene.current = {
      draw,
      // At a step, the parts still to come are hidden, the step's own are violet, and those put
      // on before are faint; the part whose card is open glows either way.
      light: (label, view) => {
        for (const each of meshes) {
          const { mesh } = each;
          const shown = view?.shown === undefined || view.shown.has(each.with);
          const current =
            view !== undefined && each.label !== undefined && view.current.has(each.with);
          const faint = view?.shown !== undefined && !view.current.has(each.with);
          mesh.visible = shown;
          mesh.material.color.copy(current ? glow : each.colour);
          mesh.material.transparent = faint;
          mesh.material.opacity = faint ? 0.35 : 1;
          mesh.material.emissive.copy(
            each.label !== undefined && each.label === label ? glow : new THREE.Color(0),
          );
          mesh.material.emissiveIntensity = 0.35;
        }
        draw();
      },
    };
    scene.current.light(litNow.current.lit, litNow.current.atStep);

    return () => {
      scene.current = undefined;
      view.current = camera.position.clone().sub(controls.target).divideScalar(reach);
      watch.disconnect();
      controls.dispose();
      for (const { mesh } of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      edges.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [built]);

  useEffect(() => scene.current?.light(lit, atStep), [lit, atStep]);

  return (
    <div ref={host} className="relative h-full w-full touch-none select-none">
      {cantDraw ? (
        <p className="flex h-full items-center justify-center px-6 text-center text-meta text-muted-foreground">
          This browser can't draw the Build in 3D. The cut plan and the buy list still work.
        </p>
      ) : (
        // At a step, only the parts put on so far have their letter; the step's own are marked.
        derived.parts
          .filter((part) => atStep?.shown === undefined || atStep.shown.has(part.label))
          .map((part) => (
            <button
              key={part.label}
              ref={(button) => {
                if (button === null) labels.current.delete(part.label);
                else labels.current.set(part.label, button);
              }}
              type="button"
              aria-label={`${part.label}, ${part.name}`}
              aria-pressed={lit === part.label}
              aria-current={atStep?.current.has(part.label) ? "step" : undefined}
              onClick={() => props.pick(part.label)}
              className={classes(
                "absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border-2 font-mono text-caption font-bold",
                lit === part.label || atStep?.current.has(part.label)
                  ? "border-primary-text bg-primary text-primary-foreground"
                  : "border-primary bg-background text-foreground",
              )}
            >
              {part.label}
            </button>
          ))
      )}
    </div>
  );
}
