import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { BoardObject } from "../boardPreview3dAdapter";

type DiceRollVisual = {
  id: string;
  label: string;
  values: number[];
};

type BoardPreview3DDiceLayerProps = {
  diceRoll?: DiceRollVisual | null;
  filteredBoardObjects: BoardObject[];
  heightScale: number;
  resolveSlotPosition: (slotId: string, fallbackX: number, fallbackZ: number) => { xPercent: number; zPercent: number };
};

const CARD_WORLD_WIDTH = 128;
const CARD_WORLD_HEIGHT = 179;
const DIE_SIZE = 34;
const DICE_ROLL_DURATION_MS = 3000;

type ViewMetrics = {
  height: number;
  width: number;
  worldHeight: number;
  worldWidth: number;
};

type SimDie = {
  hasSettled: boolean;
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotationVelocity: THREE.Vector3;
  value: number;
};

type Collider = {
  halfHeight: number;
  halfWidth: number;
  x: number;
  y: number;
};

function createFaceTexture(value: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#f8fafc");
    gradient.addColorStop(1, "#cbd5e1");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(15, 23, 42, 0.28)";
    context.lineWidth = 10;
    context.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    context.fillStyle = "#020617";

    const pipPositions: Record<number, Array<[number, number]>> = {
      1: [[80, 80]],
      2: [[48, 48], [112, 112]],
      3: [[48, 48], [80, 80], [112, 112]],
      4: [[48, 48], [112, 48], [48, 112], [112, 112]],
      5: [[48, 48], [112, 48], [80, 80], [48, 112], [112, 112]],
      6: [[48, 44], [112, 44], [48, 80], [112, 80], [48, 116], [112, 116]]
    };

    for (const [x, y] of pipPositions[value] ?? pipPositions[1]) {
      context.beginPath();
      context.arc(x, y, 12, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createDieMaterials(value: number): THREE.Material[] {
  const values = [2, 5, 3, 4, value, 6];
  return values.map(face => new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: createFaceTexture(face),
    roughness: 0.42,
    metalness: 0.05
  }));
}

function createSettledDieMaterials(value: number): THREE.Material[] {
  const values = Array.from({ length: 6 }, () => value);
  return values.map(face => new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: createFaceTexture(face),
    roughness: 0.42,
    metalness: 0.05
  }));
}

function disposeMaterials(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    const mapped = item as THREE.MeshStandardMaterial;
    mapped.map?.dispose();
    item.dispose();
  }
}

function settleDieOnValue(die: SimDie): void {
  if (die.hasSettled) return;
  disposeMaterials(die.mesh.material);
  die.mesh.material = createSettledDieMaterials(die.value);
  die.mesh.rotation.set(0.18, -0.24, 0.06);
  die.mesh.position.z = 70;
  die.hasSettled = true;
}

function resize(parent: HTMLElement, renderer: THREE.WebGLRenderer, camera: THREE.OrthographicCamera): ViewMetrics {
  const width = Math.max(1, Math.floor(parent.clientWidth));
  const height = Math.max(1, Math.floor(parent.clientHeight));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
  renderer.setSize(width, height, false);
  const visibleWidth = width;
  const visibleHeight = height;
  camera.left = visibleWidth / -2;
  camera.right = visibleWidth / 2;
  camera.top = visibleHeight / 2;
  camera.bottom = visibleHeight / -2;
  camera.updateProjectionMatrix();
  return { height, width, worldHeight: visibleHeight, worldWidth: visibleWidth };
}

function buildColliders(
  objects: BoardObject[],
  metrics: ViewMetrics,
  heightScale: number,
  resolveSlotPosition: BoardPreview3DDiceLayerProps["resolveSlotPosition"]
): Collider[] {
  return objects
    .filter(object => object.lane !== "hand")
    .map(object => {
      const position = resolveSlotPosition(object.slotId, object.xPercent, object.zPercent);
      const isSideways = object.lane === "deck" || object.lane === "cemetery";
      const width = isSideways ? CARD_WORLD_HEIGHT : CARD_WORLD_WIDTH;
      const height = isSideways ? CARD_WORLD_WIDTH : CARD_WORLD_HEIGHT;
      return {
        halfHeight: height / 2,
        halfWidth: width / 2,
        x: (position.xPercent - 50) / 100 * metrics.worldWidth,
        y: (50 - position.zPercent) / 100 * metrics.worldHeight + Math.max(0, object.yDepth * heightScale) * 0.08
      };
    });
}

export function BoardPreview3DDiceLayer({
  diceRoll,
  filteredBoardObjects,
  heightScale,
  resolveSlotPosition
}: BoardPreview3DDiceLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastRollIdRef = useRef<string>("");
  const disposeActiveRollRef = useRef<(() => void) | null>(null);
  const resizeActiveRollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    if (!diceRoll || diceRoll.values.length === 0) {
      if (lastRollIdRef.current) {
        lastRollIdRef.current = "";
        disposeActiveRollRef.current?.();
        disposeActiveRollRef.current = null;
        resizeActiveRollRef.current = null;
      }
      return;
    }
    if (lastRollIdRef.current === diceRoll.id) {
      resizeActiveRollRef.current?.();
      return;
    }
    lastRollIdRef.current = diceRoll.id;
    disposeActiveRollRef.current?.();
    disposeActiveRollRef.current = null;
    resizeActiveRollRef.current = null;

    let isDisposed = false;
    let animationFrame = 0;
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "high-performance"
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 1000);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.74);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(-120, 180, 420);
    scene.add(ambient, keyLight);

    let metrics = resize(parent, renderer, camera);
    let colliders = buildColliders(filteredBoardObjects, metrics, heightScale, resolveSlotPosition);
    const dieSize = DIE_SIZE;
    const geometry = new THREE.BoxGeometry(dieSize, dieSize, dieSize);
    const dice: SimDie[] = diceRoll.values.map((value, index) => {
      const mesh = new THREE.Mesh(geometry, createDieMaterials(value));
      const spread = diceRoll.values.length > 1 ? (index / (diceRoll.values.length - 1) - 0.5) : 0;
      const position = new THREE.Vector3(
        -metrics.worldWidth * 0.34 + spread * 120,
        metrics.worldHeight * 0.22 - index * 8,
        70 + index * 6
      );
      const velocity = new THREE.Vector3(
        6.8 + index * 0.7,
        -4.4 + ((index % 3) - 1) * 1.1,
        0
      );
      const rotationVelocity = new THREE.Vector3(
        0.2 + index * 0.018,
        0.17 + index * 0.021,
        0.12 + index * 0.015
      );
      mesh.position.copy(position);
      scene.add(mesh);
      return { hasSettled: false, mesh, position, velocity, rotationVelocity, value };
    });

    const startTime = performance.now();
    let dieRadius = dieSize * 0.72;

    function renderFrame() {
      renderer.render(scene, camera);
    }

    resizeActiveRollRef.current = () => {
      if (isDisposed) return;
      const previousMetrics = metrics;
      metrics = resize(parent, renderer, camera);
      colliders = buildColliders(filteredBoardObjects, metrics, heightScale, resolveSlotPosition);
      dieRadius = DIE_SIZE * 0.72;

      const scaleX = previousMetrics.worldWidth > 0 ? metrics.worldWidth / previousMetrics.worldWidth : 1;
      const scaleY = previousMetrics.worldHeight > 0 ? metrics.worldHeight / previousMetrics.worldHeight : 1;

      for (const die of dice) {
        die.position.x *= scaleX;
        die.position.y *= scaleY;
        die.velocity.x *= scaleX;
        die.velocity.y *= scaleY;
        die.mesh.position.copy(die.position);
      }

      renderFrame();
    };

    function animate(now: number) {
      if (isDisposed) return;
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / DICE_ROLL_DURATION_MS);
      const damping = progress > 0.72 ? 0.86 : 0.985;
      const boundsX = metrics.worldWidth / 2 - dieRadius;
      const boundsY = metrics.worldHeight / 2 - dieRadius;

      for (const die of dice) {
        if (progress < 0.94) {
          die.position.add(die.velocity);
          die.velocity.multiplyScalar(damping);

          if (die.position.x <= -boundsX || die.position.x >= boundsX) {
            die.position.x = Math.max(-boundsX, Math.min(boundsX, die.position.x));
            die.velocity.x *= -0.84;
          }
          if (die.position.y <= -boundsY || die.position.y >= boundsY) {
            die.position.y = Math.max(-boundsY, Math.min(boundsY, die.position.y));
            die.velocity.y *= -0.84;
          }

          for (const collider of colliders) {
            const overlapX = collider.halfWidth + dieRadius - Math.abs(die.position.x - collider.x);
            const overlapY = collider.halfHeight + dieRadius - Math.abs(die.position.y - collider.y);
            if (overlapX > 0 && overlapY > 0) {
              if (overlapX < overlapY) {
                die.position.x += die.position.x < collider.x ? -overlapX : overlapX;
                die.velocity.x *= -0.78;
              } else {
                die.position.y += die.position.y < collider.y ? -overlapY : overlapY;
                die.velocity.y *= -0.78;
              }
            }
          }

          die.mesh.rotation.x += die.rotationVelocity.x;
          die.mesh.rotation.y += die.rotationVelocity.y;
          die.mesh.rotation.z += die.rotationVelocity.z;
          die.mesh.position.copy(die.position);
        } else {
          settleDieOnValue(die);
        }
      }

      renderFrame();
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    }

    animationFrame = requestAnimationFrame(animate);

    disposeActiveRollRef.current = () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrame);
      for (const die of dice) {
        scene.remove(die.mesh);
        disposeMaterials(die.mesh.material);
      }
      geometry.dispose();
      renderer.clear();
      renderer.dispose();
      resizeActiveRollRef.current = null;
    };
  });

  useEffect(() => {
    return () => {
      disposeActiveRollRef.current?.();
      disposeActiveRollRef.current = null;
      resizeActiveRollRef.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} className="board-preview-3d__dice-layer" aria-hidden="true" />;
}
