import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../../../");
const IMAGE_SOURCE_CONTROLS_FILE_PATH = path.join(ROOT_DIR, "data", "admin", "image-source-controls.json");

export type ImagePurposeKey = "cardLibrary" | "expandedView" | "board3d";
export type ImageSourceKey = "excelRemote" | "githubCdn" | "railwayBucket" | "localBundled" | "placeholder";

export type ImageSourceControls = {
  cardLibrary: { scale: number; priority: ImageSourceKey[] };
  expandedView: { scale: number; priority: ImageSourceKey[] };
  board3d: { scale: number; priority: ImageSourceKey[] };
};

const IMAGE_SOURCE_OPTIONS: ImageSourceKey[] = ["excelRemote", "githubCdn", "railwayBucket", "localBundled", "placeholder"];

export const DEFAULT_IMAGE_SOURCE_CONTROLS: ImageSourceControls = {
  cardLibrary: { scale: 960, priority: ["localBundled", "railwayBucket", "excelRemote", "githubCdn", "placeholder"] },
  expandedView: { scale: 1440, priority: ["localBundled", "railwayBucket", "excelRemote", "githubCdn", "placeholder"] },
  board3d: { scale: 720, priority: ["localBundled", "railwayBucket", "excelRemote", "githubCdn", "placeholder"] }
};

const LEGACY_REMOTE_FIRST_PRIORITY: ImageSourceKey[] = ["excelRemote", "githubCdn", "railwayBucket", "localBundled", "placeholder"];

function isLegacyRemoteFirstPriority(priority: ImageSourceKey[]): boolean {
  return priority.join("|") === LEGACY_REMOTE_FIRST_PRIORITY.join("|");
}

function normalizePurpose(value: { scale?: unknown; priority?: unknown } | undefined, fallback: ImageSourceControls[ImagePurposeKey]) {
  const scale = typeof value?.scale === "number" && Number.isFinite(value.scale) ? Math.max(320, Math.min(2048, Math.round(value.scale))) : fallback.scale;
  const incoming = Array.isArray(value?.priority) ? value.priority : [];
  const cleaned = Array.from(new Set(incoming.filter((entry): entry is ImageSourceKey => IMAGE_SOURCE_OPTIONS.includes(entry as ImageSourceKey))));
  for (const option of IMAGE_SOURCE_OPTIONS) {
    if (!cleaned.includes(option)) cleaned.push(option);
  }
  const priority = cleaned.slice(0, IMAGE_SOURCE_OPTIONS.length);
  return { scale, priority: isLegacyRemoteFirstPriority(priority) ? fallback.priority : priority };
}

export function normalizeImageSourceControls(value: Partial<ImageSourceControls> | null | undefined): ImageSourceControls {
  return {
    cardLibrary: normalizePurpose(value?.cardLibrary, DEFAULT_IMAGE_SOURCE_CONTROLS.cardLibrary),
    expandedView: normalizePurpose(value?.expandedView, DEFAULT_IMAGE_SOURCE_CONTROLS.expandedView),
    board3d: normalizePurpose(value?.board3d, DEFAULT_IMAGE_SOURCE_CONTROLS.board3d)
  };
}

export async function loadImageSourceControls(): Promise<ImageSourceControls> {
  try {
    const raw = await readFile(IMAGE_SOURCE_CONTROLS_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { controls?: Partial<ImageSourceControls> };
    return normalizeImageSourceControls(parsed.controls);
  } catch {
    return DEFAULT_IMAGE_SOURCE_CONTROLS;
  }
}

export async function saveImageSourceControls(value: Partial<ImageSourceControls>): Promise<ImageSourceControls> {
  const controls = normalizeImageSourceControls(value);
  await mkdir(path.dirname(IMAGE_SOURCE_CONTROLS_FILE_PATH), { recursive: true });
  await writeFile(
    IMAGE_SOURCE_CONTROLS_FILE_PATH,
    `${JSON.stringify({ controls, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf-8"
  );
  return controls;
}
