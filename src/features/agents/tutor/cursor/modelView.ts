import { modelInk, screenMarkClass, sketchInk } from "@/shared/ui";
import type { SketchElement, Vector3 } from "./companionSketch";

/**
 * A drawing's 3D model (surface "model"), drawn with three.js, which loads with the first model.
 * Parts fly in as they arrive (for a spoken answer, as the voice begins each part's sentence),
 * every part has a dark outline like a sketch, and the part being talked about glows. Each named
 * part keeps its name pinned beside it. Over the screen the model turns slowly on its own, since
 * the overlay can't be touched; in the chat it can be dragged around.
 */
export interface ModelView {
  /** The parts to show now, and the one being talked about. */
  update(parts: SketchElement[], current?: string): void;
  dispose(): void;
}

/** How long a part takes to fly in. */
const ARRIVE_MS = 450;
/** How fast the model turns on its own, in radians a second. */
const SPIN = 0.3;

type Three = typeof import("three");

interface Shown {
  object: import("three").Object3D;
  materials: import("three").MeshStandardMaterial[];
  label: HTMLDivElement | undefined;
  since: number;
}

const radians = (turn: Vector3 | undefined): Vector3 =>
  (turn ?? [0, 0, 0]).map((degrees) => (degrees * Math.PI) / 180) as Vector3;

export async function createModelView(
  container: HTMLElement,
  { draggable }: { draggable: boolean },
): Promise<ModelView> {
  const THREE: Three = await import("three");
  const width = () => Math.max(1, container.clientWidth);
  const height = () => Math.max(1, container.clientHeight);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width(), height(), false);
  renderer.domElement.classList.add("size-full");
  const labels = document.createElement("div");
  labels.className = "pointer-events-none absolute inset-0 overflow-hidden";
  container.classList.add("relative");
  container.append(renderer.domElement, labels);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 6, 5);
  scene.add(sun);
  const model = new THREE.Group();
  scene.add(model);
  const camera = new THREE.PerspectiveCamera(35, width() / height(), 0.05, 500);
  camera.position.set(0, 2.2, 9);
  const target = new THREE.Vector3();

  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let controls: import("three/addons/controls/OrbitControls.js").OrbitControls | undefined;
  let touched = false;
  if (draggable) {
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.addEventListener("start", () => (touched = true));
  }

  const shown = new Map<string, Shown>();
  let current: string | undefined;
  let fitted = 0;

  const color = (part: SketchElement) =>
    new THREE.Color(part.color ? sketchInk.board[part.color] : modelInk.part);

  const solid = (part: SketchElement) => {
    const [w, h, d] = part.size ?? [1, 1, 1];
    switch (part.shape) {
      case "sphere":
        return { geometry: new THREE.SphereGeometry(0.5, 32, 16), scale: [w, h, d] as Vector3 };
      case "cylinder":
        return { geometry: new THREE.CylinderGeometry(0.5, 0.5, 1, 32), scale: [w, h, d] as Vector3 };
      case "cone":
        return { geometry: new THREE.ConeGeometry(0.5, 1, 32), scale: [w, h, d] as Vector3 };
      case "torus":
        // A ring w across, its tube as thick as h.
        return {
          geometry: new THREE.TorusGeometry(Math.max(0.01, (w - h) / 2), h / 2, 16, 48),
          scale: [1, 1, Math.max(0.01, d / h)] as Vector3,
        };
      case "capsule":
        return {
          geometry: new THREE.CapsuleGeometry(w / 2, Math.max(0, h - w), 8, 16),
          scale: [1, 1, Math.max(0.01, d / w)] as Vector3,
        };
      default:
        return { geometry: new THREE.BoxGeometry(1, 1, 1), scale: [w, h, d] as Vector3 };
    }
  };

  const outline = (geometry: import("three").BufferGeometry) =>
    new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 28),
      new THREE.LineBasicMaterial({ color: modelInk.edge, transparent: true, opacity: 0.7 }),
    );

  const build = (part: SketchElement): Shown => {
    const material = new THREE.MeshStandardMaterial({
      color: color(part),
      roughness: 0.55,
      metalness: 0.08,
      emissive: new THREE.Color(modelInk.glow),
      emissiveIntensity: 0,
    });
    let object: import("three").Object3D;
    if (part.shape === "arrow" && part.ends) {
      // A shaft and a head from the tail to the head, for a force or a flow.
      const [tail, head] = part.ends.map((end) => new THREE.Vector3(...end));
      const direction = head.clone().sub(tail);
      const length = Math.max(0.05, direction.length());
      const tip = Math.min(length * 0.35, 0.45);
      const group = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, length - tip, 12), material);
      shaft.position.y = (length - tip) / 2;
      const point = new THREE.Mesh(new THREE.ConeGeometry(0.13, tip, 16), material);
      point.position.y = length - tip / 2;
      group.add(shaft, point);
      group.position.copy(tail);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      object = group;
    } else {
      const { geometry, scale } = solid(part);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.add(outline(geometry));
      const holder = new THREE.Group();
      mesh.scale.set(...scale);
      holder.add(mesh);
      holder.position.set(...(part.at ?? [0, 0, 0]));
      holder.rotation.set(...radians(part.turn));
      object = holder;
    }
    let label: HTMLDivElement | undefined;
    if (part.label) {
      label = document.createElement("div");
      label.className = screenMarkClass.modelLabel;
      label.textContent = part.label;
      labels.append(label);
    }
    object.scale.setScalar(0.001);
    model.add(object);
    return { object, materials: [material], label, since: performance.now() };
  };

  /** Moves the camera so every part fits, as parts arrive. */
  const fit = () => {
    if (shown.size === fitted) return;
    fitted = shown.size;
    const box = new THREE.Box3();
    for (const { object } of shown.values()) {
      const scale = object.scale.clone();
      object.scale.setScalar(1);
      object.updateMatrixWorld(true);
      box.expandByObject(object);
      object.scale.copy(scale);
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    target.copy(sphere.center);
    const distance = (Math.max(sphere.radius, 0.5) / Math.sin((camera.fov * Math.PI) / 360)) * 1.1;
    const direction = camera.position.clone().sub(controls?.target ?? target).normalize();
    if (direction.lengthSq() < 0.01) direction.set(0, 0.25, 1).normalize();
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.near = Math.max(0.01, distance / 100);
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    controls?.target.copy(target);
  };

  const place = new THREE.Vector3();
  let frame = 0;
  let last = performance.now();
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const seconds = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const [id, part] of shown) {
      const t = Math.min(1, (now - part.since) / ARRIVE_MS);
      part.object.scale.setScalar(still ? 1 : 1 - (1 - t) ** 3);
      for (const material of part.materials) material.emissiveIntensity = id === current ? 0.45 : 0;
    }
    if (!still && !touched) model.rotation.y += seconds * SPIN;
    if (controls) controls.update();
    else camera.lookAt(target);
    renderer.render(scene, camera);
    // Each name stays beside its part as the model turns.
    const w = width();
    const h = height();
    for (const [id, part] of shown) {
      if (!part.label) continue;
      part.object.getWorldPosition(place).project(camera);
      const visible = place.z < 1;
      part.label.style.opacity = visible ? "1" : "0";
      part.label.style.transform = `translate(${((place.x + 1) / 2) * w + 8}px, ${((1 - place.y) / 2) * h - 10}px)`;
      part.label.toggleAttribute("data-current", id === current);
    }
  };
  frame = requestAnimationFrame(tick);

  const resized = new ResizeObserver(() => {
    renderer.setSize(width(), height(), false);
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
  });
  resized.observe(container);

  return {
    update(parts, now) {
      current = now;
      const keep = new Set(parts.map((part) => part.id));
      for (const [id, part] of shown) {
        if (keep.has(id)) continue;
        model.remove(part.object);
        part.label?.remove();
        shown.delete(id);
      }
      for (const part of parts) if (!shown.has(part.id)) shown.set(part.id, build(part));
      fit();
    },
    dispose() {
      cancelAnimationFrame(frame);
      resized.disconnect();
      controls?.dispose();
      model.traverse((object) => {
        const mesh = object as import("three").Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as import("three").Material | undefined;
        material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.remove();
    },
  };
}
