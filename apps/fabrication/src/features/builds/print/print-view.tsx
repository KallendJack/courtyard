import type { BuildPrint, MadePart } from "@courtyard/contract";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// A printed part in 3D (#702): the made solid on the printer's plate, with the space the printer
// reaches drawn round it, turnable. Loaded lazily (`print-panel.tsx`), so `three` is in this
// view's own file, as the bench's is.

/** A colour by its name in the theme (packages/ui/theme.css), since a 3D scene can't read classes. */
const themed = (name: string) =>
  new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());

/** The plate's grid, a line every this many mm. */
const GRID_MM = 16;

/** How far the view sees, at least, either side of its middle: 30° across. */
const VIEW_DEGREES = 30;
const HALF_VIEW = Math.tan(((VIEW_DEGREES / 2) * Math.PI) / 180);

/**
 * The part as the scene draws it: the engine's `x` across, `y` back and `z` up, as three's `x`,
 * `-z` and `y`, standing in the middle of the plate.
 */
const geometryOf = (made: MadePart) => {
  const geometry = new THREE.BufferGeometry();
  const { positions } = made.mesh;
  const placed = new Float32Array(positions.length);
  for (let at = 0; at < positions.length; at += 3) {
    placed[at] = (positions[at] ?? 0) - made.size.length / 2;
    placed[at + 1] = positions[at + 2] ?? 0;
    placed[at + 2] = made.size.depth / 2 - (positions[at + 1] ?? 0);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(placed, 3));
  geometry.setIndex(made.mesh.triangles);
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * What the scene is built from, as text to compare: the plate, the part's size and a sum over its
 * corners. The page asks for the part again every 30 seconds and gets the same numbers in a new
 * object; only new numbers build the scene again.
 */
const shapeOf = (made: MadePart, plate: BuildPrint["plate"]) =>
  JSON.stringify([
    plate,
    made.size,
    made.mesh.triangles.length,
    made.mesh.positions.reduce((sum, mm, index) => sum + mm * ((index % 7) + 1), 0),
  ]);

/**
 * The scene, drawn when something changes it (a turn, a new part), never in a loop. Built again
 * only when the part changes, from where the owner had turned it.
 */
export default function PrintView(props: { made: MadePart; plate: BuildPrint["plate"] }) {
  const { made, plate } = props;
  const host = useRef<HTMLDivElement>(null);
  const [cantDraw, setCantDraw] = useState(false);
  const view = useRef<THREE.Vector3>(undefined);
  const shape = shapeOf(made, plate);
  const [drawn, setDrawn] = useState({ made, plate, shape });
  if (drawn.shape !== shape) setDrawn({ made, plate, shape });

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

    const { made: part, plate: bed } = drawn;
    const reach = Math.max(bed.width, bed.depth, bed.height);
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(VIEW_DEGREES, 1, reach / 50, reach * 20);
    // The whole space the printer reaches in view, the part standing in the middle of its plate.
    const target = new THREE.Vector3(0, bed.height * 0.4, 0);
    camera.position.copy(
      view.current === undefined
        ? new THREE.Vector3(-1, 0.8, 1.3).normalize().multiplyScalar(reach * 3)
        : view.current.clone().multiplyScalar(reach).add(target),
    );
    world.add(new THREE.HemisphereLight(0xffffff, 0x202020, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-reach, reach * 2, reach * 1.5);
    world.add(sun);

    const line = themed("muted-foreground");
    const grid = new THREE.GridHelper(
      Math.max(bed.width, bed.depth),
      Math.round(Math.max(bed.width, bed.depth) / GRID_MM),
      line,
      line,
    );
    grid.scale.set(
      bed.width / Math.max(bed.width, bed.depth),
      1,
      bed.depth / Math.max(bed.width, bed.depth),
    );
    for (const material of [grid.material].flat()) {
      material.transparent = true;
      material.opacity = 0.25;
    }
    world.add(grid);
    const space = new THREE.BoxGeometry(bed.width, bed.height, bed.depth);
    const reachable = new THREE.LineSegments(
      new THREE.EdgesGeometry(space),
      new THREE.LineDashedMaterial({
        color: line,
        dashSize: 6,
        gapSize: 6,
        transparent: true,
        opacity: 0.45,
      }),
    );
    reachable.computeLineDistances();
    reachable.position.y = bed.height / 2;
    world.add(reachable);

    const geometry = geometryOf(part);
    const material = new THREE.MeshStandardMaterial({ color: themed("printed"), roughness: 0.7 });
    world.add(new THREE.Mesh(geometry, material));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enablePan = false;
    controls.minDistance = reach * 0.4;
    controls.maxDistance = reach * 4;

    const draw = () => renderer.render(world, camera);
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // A panel taller than it's wide sees as far across as a square one, so the plate stays whole.
      camera.fov = (2 * Math.atan(HALF_VIEW / Math.min(camera.aspect, 1)) * 180) / Math.PI;
      camera.updateProjectionMatrix();
      draw();
    };
    controls.addEventListener("change", draw);
    controls.update();
    const watch = new ResizeObserver(resize);
    watch.observe(element);

    return () => {
      view.current = camera.position.clone().sub(controls.target).divideScalar(reach);
      watch.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      space.dispose();
      reachable.geometry.dispose();
      reachable.material.dispose();
      grid.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [drawn]);

  return (
    <div ref={host} className="relative h-full w-full touch-none select-none">
      {cantDraw && (
        <p className="flex h-full items-center justify-center px-6 text-center text-meta text-muted-foreground">
          This browser can't draw the part in 3D. Its sizes and file still work.
        </p>
      )}
    </div>
  );
}
