import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ImgHTMLAttributes } from "react";

type HolographicCardImageProps = {
  src: string;
  alt: string;
  seed: string;
  enabled?: boolean;
  animated?: boolean;
  holoOpacity?: number;
  intensity?: number;
  sheenIntensity?: number;
  className?: string;
  draggable?: ImgHTMLAttributes<HTMLImageElement>["draggable"];
  onError?: ImgHTMLAttributes<HTMLImageElement>["onError"];
};

export type HoloShard = {
  points: string;
  vertices: Array<[number, number]>;
  fill: string;
  opacity: number;
  strokeOpacity: number;
  shimmerDelay: number;
  shimmerDuration: number;
  shimmerPeak: number;
};

type HolographicCanvasLayerProps = {
  holoOpacity: number;
  seed: string;
  sheenIntensity: number;
  intensity: number;
};

export type HoloCanvasConfig = {
  id: string;
  columns: number;
  rows: number;
  fillStrength: number;
  shimmerStrength: number;
  shimmerWindow: number;
  strokeStrength: number;
  strokeThreshold: number;
  sweepAlpha: number;
  sweepSpeed: number;
  sweepWidth: number;
  sweepColors: [number, string][];
};

type HoloCanvasRuntime = {
  active: boolean;
  render: (timeMs: number) => void;
};

const HOLO_COLORS = [
  "rgba(125, 249, 255, 0.9)",
  "rgba(168, 85, 247, 0.86)",
  "rgba(244, 114, 182, 0.82)",
  "rgba(250, 204, 21, 0.78)",
  "rgba(74, 222, 128, 0.78)",
  "rgba(96, 165, 250, 0.84)"
];

const STATIC_SHARD_COLUMNS = 8;
const STATIC_SHARD_ROWS = 12;
const CANVAS_FRAME_INTERVAL_MS = 1000 / 24;
const MAX_CANVAS_DEVICE_PIXEL_RATIO = 1.35;
const DEFAULT_HOLO_OPACITY = 1.24;
const DEFAULT_HOLO_SHEEN_INTENSITY = 0.42;
const HOLO_CANVAS_CONFIGS: HoloCanvasConfig[] = [
  {
    id: "fractured-prism",
    columns: 14,
    rows: 20,
    fillStrength: 0.58,
    shimmerStrength: 0.34,
    shimmerWindow: 0.11,
    strokeStrength: 0.24,
    strokeThreshold: 0.08,
    sweepAlpha: 0.18,
    sweepSpeed: 0.18,
    sweepWidth: 0.85,
    sweepColors: [
      [0, "rgba(255, 255, 255, 0)"],
      [0.42, "rgba(255, 255, 255, 0.28)"],
      [0.5, "rgba(125, 249, 255, 0.38)"],
      [0.6, "rgba(244, 114, 182, 0.26)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  {
    id: "aurora-bands",
    columns: 12,
    rows: 18,
    fillStrength: 0.66,
    shimmerStrength: 0.24,
    shimmerWindow: 0.18,
    strokeStrength: 0.14,
    strokeThreshold: 0.14,
    sweepAlpha: 0.28,
    sweepSpeed: 0.12,
    sweepWidth: 1.1,
    sweepColors: [
      [0, "rgba(255, 255, 255, 0)"],
      [0.3, "rgba(74, 222, 128, 0.22)"],
      [0.48, "rgba(125, 249, 255, 0.42)"],
      [0.66, "rgba(168, 85, 247, 0.3)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  {
    id: "needle-spark",
    columns: 16,
    rows: 20,
    fillStrength: 0.48,
    shimmerStrength: 0.44,
    shimmerWindow: 0.07,
    strokeStrength: 0.3,
    strokeThreshold: 0.05,
    sweepAlpha: 0.14,
    sweepSpeed: 0.26,
    sweepWidth: 0.62,
    sweepColors: [
      [0, "rgba(255, 255, 255, 0)"],
      [0.45, "rgba(250, 204, 21, 0.26)"],
      [0.52, "rgba(255, 255, 255, 0.5)"],
      [0.58, "rgba(96, 165, 250, 0.32)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  },
  {
    id: "deep-rainbow",
    columns: 13,
    rows: 19,
    fillStrength: 0.7,
    shimmerStrength: 0.28,
    shimmerWindow: 0.13,
    strokeStrength: 0.18,
    strokeThreshold: 0.1,
    sweepAlpha: 0.22,
    sweepSpeed: 0.16,
    sweepWidth: 0.95,
    sweepColors: [
      [0, "rgba(255, 255, 255, 0)"],
      [0.28, "rgba(244, 114, 182, 0.28)"],
      [0.45, "rgba(168, 85, 247, 0.38)"],
      [0.62, "rgba(45, 212, 191, 0.34)"],
      [0.78, "rgba(250, 204, 21, 0.18)"],
      [1, "rgba(255, 255, 255, 0)"]
    ]
  }
];

function clampIntensity(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.45;
  }

  return Math.min(10, Math.max(0, value));
}

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 1;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}

function clampTuningValue(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(2, Math.max(0, value));
}

export function chooseCanvasConfig(seed: string): HoloCanvasConfig {
  return HOLO_CANVAS_CONFIGS[hashSeed(seed) % HOLO_CANVAS_CONFIGS.length] ?? HOLO_CANVAS_CONFIGS[0]!;
}

function formatPoint(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function createMeshPoint(
  column: number,
  row: number,
  columns: number,
  rows: number,
  random: () => number
): [number, number] {
  const cellWidth = 100 / columns;
  const cellHeight = 140 / rows;
  const edgeColumn = column === 0 || column === columns;
  const edgeRow = row === 0 || row === rows;
  const jitterX = edgeColumn ? 0 : (random() - 0.5) * cellWidth * 0.62;
  const jitterY = edgeRow ? 0 : (random() - 0.5) * cellHeight * 0.62;

  return [
    Math.min(100, Math.max(0, column * cellWidth + jitterX)),
    Math.min(140, Math.max(0, row * cellHeight + jitterY))
  ];
}

function formatTriangle(points: Array<[number, number]>): string {
  return points
    .map(([x, y]) => `${formatPoint(x)},${formatPoint(y)}`)
    .join(" ");
}

function createShard(points: Array<[number, number]>, random: () => number): HoloShard {
  const shineLevel = random();
  const colorOffset = Math.floor((points[0][0] + points[1][1] + random() * 20) % HOLO_COLORS.length);

  return {
    points: formatTriangle(points),
    vertices: points,
    fill: HOLO_COLORS[colorOffset] ?? HOLO_COLORS[0],
    opacity: 0.05 + shineLevel * shineLevel * 0.34,
    strokeOpacity: 0.04 + shineLevel * 0.16,
    shimmerDelay: -random() * 8,
    shimmerDuration: 3.5 + random() * 7,
    shimmerPeak: 0.18 + shineLevel * 0.62
  };
}

export function createShardPolygons(seed: string, columns = STATIC_SHARD_COLUMNS, rows = STATIC_SHARD_ROWS): HoloShard[] {
  const random = createSeededRandom(seed);
  const meshPoints: Array<Array<[number, number]>> = [];
  const shards: HoloShard[] = [];

  for (let row = 0; row <= rows; row += 1) {
    meshPoints[row] = [];

    for (let column = 0; column <= columns; column += 1) {
      meshPoints[row][column] = createMeshPoint(column, row, columns, rows, random);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = meshPoints[row][column];
      const topRight = meshPoints[row][column + 1];
      const bottomLeft = meshPoints[row + 1][column];
      const bottomRight = meshPoints[row + 1][column + 1];

      if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
        continue;
      }

      if (random() > 0.5) {
        shards.push(createShard([topLeft, topRight, bottomRight], random));
        shards.push(createShard([topLeft, bottomRight, bottomLeft], random));
      } else {
        shards.push(createShard([topLeft, topRight, bottomLeft], random));
        shards.push(createShard([topRight, bottomRight, bottomLeft], random));
      }
    }
  }

  return shards;
}

function normalizePhase(value: number): number {
  const phase = value % 1;
  return phase < 0 ? phase + 1 : phase;
}

function smoothPulse(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function traceShard(context: CanvasRenderingContext2D, shard: HoloShard, width: number, height: number) {
  context.beginPath();

  shard.vertices.forEach(([x, y], index) => {
    const scaledX = (x / 100) * width;
    const scaledY = (y / 140) * height;

    if (index === 0) {
      context.moveTo(scaledX, scaledY);
      return;
    }

    context.lineTo(scaledX, scaledY);
  });

  context.closePath();
}

export function drawHolographicCanvas(
  context: CanvasRenderingContext2D,
  shards: HoloShard[],
  width: number,
  height: number,
  timeSeconds: number,
  intensity: number,
  config: HoloCanvasConfig,
  options: { clear?: boolean; holoOpacity?: number; sheenIntensity?: number } = {}
) {
  if (options.clear !== false) {
    context.clearRect(0, 0, width, height);
  }

  if (width <= 0 || height <= 0) {
    return;
  }

  const intensityScale = Math.min(1.18, Math.max(0.18, intensity / 5.4));
  const holoOpacity = clampTuningValue(options.holoOpacity, DEFAULT_HOLO_OPACITY);
  const sheenIntensity = clampTuningValue(options.sheenIntensity, DEFAULT_HOLO_SHEEN_INTENSITY);
  const strokeWidth = Math.max(0.45, Math.min(width, height) * 0.0012);

  context.save();
  context.lineJoin = "round";
  context.globalCompositeOperation = "source-over";

  for (const shard of shards) {
    const phase = normalizePhase((timeSeconds - shard.shimmerDelay) / shard.shimmerDuration);
    const shimmerWindow = 1 - Math.abs(phase - 0.5) / config.shimmerWindow;
    const shimmer = smoothPulse(shimmerWindow);

    traceShard(context, shard, width, height);
    context.fillStyle = shard.fill;
    context.globalAlpha = Math.min(0.86, (shard.opacity * config.fillStrength * holoOpacity + shimmer * shard.shimmerPeak * config.shimmerStrength * sheenIntensity) * intensityScale);
    context.fill();

    if (shimmer > config.strokeThreshold) {
      traceShard(context, shard, width, height);
      context.strokeStyle = "rgba(255, 255, 255, 0.72)";
      context.lineWidth = strokeWidth;
      context.globalAlpha = Math.min(0.42, (shard.strokeOpacity * holoOpacity * 0.72 + shimmer * config.strokeStrength * sheenIntensity) * intensityScale);
      context.stroke();
    }
  }

  context.globalCompositeOperation = "screen";

  const sweepProgress = normalizePhase(timeSeconds * config.sweepSpeed);
  const sweepX = -width * 0.85 + sweepProgress * width * 1.9;
  const sweepGradient = context.createLinearGradient(sweepX, 0, sweepX + width * config.sweepWidth, height);

  for (const [stop, color] of config.sweepColors) {
    sweepGradient.addColorStop(stop, color);
  }

  context.fillStyle = sweepGradient;
  context.globalAlpha = Math.min(0.48, config.sweepAlpha * intensityScale * sheenIntensity);
  context.fillRect(0, 0, width, height);

  context.restore();
}

const activeHoloCanvasRuntimes = new Set<HoloCanvasRuntime>();
let sharedHoloAnimationFrame = 0;
let sharedHoloLastDrawTime = 0;

function hasActiveHoloCanvasRuntime(): boolean {
  for (const runtime of activeHoloCanvasRuntimes) {
    if (runtime.active) return true;
  }

  return false;
}

function runSharedHoloAnimationFrame(timeMs: number) {
  sharedHoloAnimationFrame = 0;

  if (timeMs - sharedHoloLastDrawTime >= CANVAS_FRAME_INTERVAL_MS) {
    for (const runtime of activeHoloCanvasRuntimes) {
      if (runtime.active) runtime.render(timeMs);
    }

    sharedHoloLastDrawTime = timeMs;
  }

  if (hasActiveHoloCanvasRuntime()) {
    sharedHoloAnimationFrame = window.requestAnimationFrame(runSharedHoloAnimationFrame);
  }
}

function requestSharedHoloAnimationFrame() {
  if (sharedHoloAnimationFrame !== 0 || !hasActiveHoloCanvasRuntime()) {
    return;
  }

  sharedHoloAnimationFrame = window.requestAnimationFrame(runSharedHoloAnimationFrame);
}

function registerHoloCanvasRuntime(runtime: HoloCanvasRuntime): () => void {
  activeHoloCanvasRuntimes.add(runtime);
  requestSharedHoloAnimationFrame();

  return () => {
    activeHoloCanvasRuntimes.delete(runtime);

    if (activeHoloCanvasRuntimes.size === 0 && sharedHoloAnimationFrame !== 0) {
      window.cancelAnimationFrame(sharedHoloAnimationFrame);
      sharedHoloAnimationFrame = 0;
    }
  };
}

function HolographicCanvasLayer({ holoOpacity, seed, sheenIntensity, intensity }: HolographicCanvasLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const config = useMemo(() => chooseCanvasConfig(seed), [seed]);
  const shards = useMemo(
    () => createShardPolygons(`${seed}:animated:${config.id}`, config.columns, config.rows),
    [config, seed]
  );

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });

    if (!context) {
      return;
    }

    let documentVisible = document.visibilityState !== "hidden";
    let viewportVisible = true;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionQuery.matches;

    function renderAt(timeMs: number) {
      drawHolographicCanvas(context, shards, canvas.width, canvas.height, timeMs / 1000, intensity, config, { holoOpacity, sheenIntensity });
    }

    const runtime: HoloCanvasRuntime = {
      active: false,
      render: renderAt
    };

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DEVICE_PIXEL_RATIO);
      const nextWidth = Math.max(1, Math.round(rect.width * ratio));
      const nextHeight = Math.max(1, Math.round(rect.height * ratio));

      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }

      renderAt(performance.now());
    }

    function syncAnimationState() {
      resizeCanvas();
      runtime.active = viewportVisible && documentVisible && !reducedMotion;
      requestSharedHoloAnimationFrame();
    }

    const handleMotionPreferenceChange = () => {
      reducedMotion = motionQuery.matches;
      syncAnimationState();
    };

    const handleVisibilityChange = () => {
      documentVisible = document.visibilityState !== "hidden";
      syncAnimationState();
    };

    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", resizeCanvas);
    }

    if (typeof IntersectionObserver === "function") {
      viewportVisible = false;
      intersectionObserver = new IntersectionObserver(entries => {
        viewportVisible = entries.some(entry => entry.isIntersecting);
        syncAnimationState();
      }, { rootMargin: "240px 0px" });
      intersectionObserver.observe(canvas);
    }

    const unregisterRuntime = registerHoloCanvasRuntime(runtime);

    motionQuery.addEventListener("change", handleMotionPreferenceChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    syncAnimationState();

    return () => {
      runtime.active = false;
      unregisterRuntime();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("resize", resizeCanvas);
      motionQuery.removeEventListener("change", handleMotionPreferenceChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [config, holoOpacity, intensity, sheenIntensity, shards]);

  return <canvas className="holo-canvas-layer" data-holo-config={config.id} ref={canvasRef} aria-hidden="true" />;
}

export function HolographicCardImage({
  src,
  alt,
  seed,
  enabled = false,
  animated = false,
  holoOpacity,
  intensity,
  sheenIntensity,
  className,
  draggable,
  onError
}: HolographicCardImageProps) {
  const clampedIntensity = clampIntensity(intensity);
  const clampedHoloOpacity = clampTuningValue(holoOpacity, DEFAULT_HOLO_OPACITY);
  const clampedSheenIntensity = clampTuningValue(sheenIntensity, DEFAULT_HOLO_SHEEN_INTENSITY);
  const showHolo = enabled && clampedIntensity > 0;
  const shards = useMemo(() => showHolo ? createShardPolygons(seed) : [], [seed, showHolo]);
  const style = {
    "--holo-intensity": clampedIntensity,
    "--holo-opacity": clampedHoloOpacity,
    "--holo-sheen": clampedSheenIntensity
  } as CSSProperties;
  const wrapClassName = [
    "holo-card-wrap",
    showHolo && animated ? "is-holo-animated" : "is-holo-static",
    className
  ].filter(Boolean).join(" ");

  return (
    <span className={wrapClassName} style={style}>
      <img className="holo-card-base-image" src={src} alt={alt} draggable={draggable} loading="lazy" decoding="async" onError={onError} />
      {showHolo ? (
        <>
          <span className="holo-rainbow-layer" aria-hidden="true" />
          {animated ? (
            <HolographicCanvasLayer
              holoOpacity={clampedHoloOpacity}
              seed={seed}
              sheenIntensity={clampedSheenIntensity}
              intensity={clampedIntensity}
            />
          ) : (
            <svg className="holo-shard-layer" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
              {shards.map((shard, index) => (
                <polygon
                  key={`${shard.points}-${index}`}
                  points={shard.points}
                  fill={shard.fill}
                  opacity={shard.opacity}
                  stroke="rgba(255, 255, 255, 0.42)"
                  strokeWidth="0.18"
                  strokeOpacity={shard.strokeOpacity}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
          <span className="holo-soft-band-layer" aria-hidden="true" />
          <span className="holo-speckle-layer" aria-hidden="true" />
          <span className="holo-glint-layer" aria-hidden="true" />
        </>
      ) : null}
    </span>
  );
}
