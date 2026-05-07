import { useMemo } from "react";
import type { CSSProperties, ImgHTMLAttributes } from "react";

type HolographicCardImageProps = {
  src: string;
  alt: string;
  seed: string;
  enabled?: boolean;
  intensity?: number;
  className?: string;
  onError?: ImgHTMLAttributes<HTMLImageElement>["onError"];
};

type HoloShard = {
  points: string;
  fill: string;
  opacity: number;
  strokeOpacity: number;
  shimmerDelay: number;
  shimmerDuration: number;
  shimmerPeak: number;
};

const HOLO_COLORS = [
  "rgba(125, 249, 255, 0.9)",
  "rgba(168, 85, 247, 0.86)",
  "rgba(244, 114, 182, 0.82)",
  "rgba(250, 204, 21, 0.78)",
  "rgba(74, 222, 128, 0.78)",
  "rgba(96, 165, 250, 0.84)"
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
    fill: HOLO_COLORS[colorOffset] ?? HOLO_COLORS[0],
    opacity: 0.05 + shineLevel * shineLevel * 0.34,
    strokeOpacity: 0.04 + shineLevel * 0.16,
    shimmerDelay: -random() * 8,
    shimmerDuration: 3.5 + random() * 7,
    shimmerPeak: 0.18 + shineLevel * 0.62
  };
}

function createShardPolygons(seed: string): HoloShard[] {
  const random = createSeededRandom(seed);
  const columns = 14;
  const rows = 20;
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

export function HolographicCardImage({
  src,
  alt,
  seed,
  enabled = false,
  intensity,
  className,
  onError
}: HolographicCardImageProps) {
  const clampedIntensity = clampIntensity(intensity);
  const showHolo = enabled && clampedIntensity > 0;
  const shards = useMemo(() => showHolo ? createShardPolygons(seed) : [], [seed, showHolo]);
  const style = { "--holo-intensity": clampedIntensity } as CSSProperties;
  const wrapClassName = className ? `holo-card-wrap ${className}` : "holo-card-wrap";

  return (
    <span className={wrapClassName} style={style}>
      <img className="holo-card-base-image" src={src} alt={alt} loading="lazy" decoding="async" onError={onError} />
      {showHolo ? (
        <>
          <span className="holo-rainbow-layer" aria-hidden="true" />
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
          <svg className="holo-facet-shine-layer" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
            {shards.map((shard, index) => (
              <polygon
                key={`${shard.points}-shine-${index}`}
                className="holo-facet-shine"
                points={shard.points}
                fill={shard.fill}
                stroke="rgba(255, 255, 255, 0.75)"
                strokeWidth="0.2"
                vectorEffect="non-scaling-stroke"
                style={{
                  "--holo-facet-delay": `${formatPoint(shard.shimmerDelay)}s`,
                  "--holo-facet-duration": `${formatPoint(shard.shimmerDuration)}s`,
                  "--holo-facet-peak": shard.shimmerPeak
                } as CSSProperties}
              />
            ))}
          </svg>
          <span className="holo-soft-band-layer" aria-hidden="true" />
          <span className="holo-speckle-layer" aria-hidden="true" />
        </>
      ) : null}
    </span>
  );
}
