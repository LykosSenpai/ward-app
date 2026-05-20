export type ImagePurposeKey = "cardLibrary" | "expandedView" | "board3d";
export type ImageSourceKey = "excelRemote" | "githubCdn" | "railwayBucket" | "localBundled" | "placeholder";

export type ImageSourceControls = {
  cardLibrary: { scale: number; priority: ImageSourceKey[] };
  expandedView: { scale: number; priority: ImageSourceKey[] };
  board3d: { scale: number; priority: ImageSourceKey[] };
};

export const IMAGE_SOURCE_STORAGE_KEY = "ward:image-source-controls:v1";
export const IMAGE_SOURCE_REMOTE_ENABLED_STORAGE_KEY = "ward:image-source-remote-enabled:v1";
export const IMAGE_SOURCE_OPTIONS: Array<{ value: ImageSourceKey; label: string }> = [
  { value: "excelRemote", label: "Excel/Wix Remote" },
  { value: "githubCdn", label: "GitHub CDN" },
  { value: "railwayBucket", label: "Railway Bucket (Signed URL)" },
  { value: "localBundled", label: "App /card-images Route" },
  { value: "placeholder", label: "Placeholder" }
];

export const DEFAULT_IMAGE_SOURCE_CONTROLS: ImageSourceControls = {
  cardLibrary: { scale: 960, priority: ["localBundled", "railwayBucket", "excelRemote", "githubCdn", "placeholder"] },
  expandedView: { scale: 1440, priority: ["localBundled", "railwayBucket", "excelRemote", "githubCdn", "placeholder"] },
  board3d: { scale: 720, priority: ["localBundled", "railwayBucket", "excelRemote", "githubCdn", "placeholder"] }
};

const LEGACY_REMOTE_FIRST_PRIORITY: ImageSourceKey[] = ["excelRemote", "githubCdn", "railwayBucket", "localBundled", "placeholder"];

function isLegacyRemoteFirstPriority(priority: ImageSourceKey[] | undefined): boolean {
  return Array.isArray(priority) && priority.join("|") === LEGACY_REMOTE_FIRST_PRIORITY.join("|");
}

function migrateLegacyPurposeControls(
  value: ImageSourceControls[ImagePurposeKey] | undefined,
  fallback: ImageSourceControls[ImagePurposeKey]
): ImageSourceControls[ImagePurposeKey] {
  const purpose = value ?? fallback;

  if (isLegacyRemoteFirstPriority(purpose.priority)) {
    return { ...purpose, priority: fallback.priority };
  }

  return purpose;
}

export function areRemoteCardImagesEnabled(): boolean {
  const envValue = (import.meta.env.VITE_ENABLE_REMOTE_CARD_IMAGES as string | undefined)?.trim().toLowerCase();
  if (envValue === "0" || envValue === "false" || envValue === "off") return false;
  if (envValue === "1" || envValue === "true" || envValue === "on") return true;
  try {
    const stored = localStorage.getItem(IMAGE_SOURCE_REMOTE_ENABLED_STORAGE_KEY);
    if (!stored) return true;
    return stored === "1";
  } catch {
    return true;
  }
}

export function saveRemoteCardImagesEnabled(enabled: boolean): void {
  localStorage.setItem(IMAGE_SOURCE_REMOTE_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new CustomEvent("ward:image-source-controls-changed"));
}

function enforceRemoteToggle(controls: ImageSourceControls): ImageSourceControls {
  if (areRemoteCardImagesEnabled()) return controls;
  const stripRemote = (priority: ImageSourceKey[]): ImageSourceKey[] =>
    priority.filter(source => source !== "excelRemote" && source !== "githubCdn" && source !== "railwayBucket");

  return {
    cardLibrary: { ...controls.cardLibrary, priority: stripRemote(controls.cardLibrary.priority) },
    expandedView: { ...controls.expandedView, priority: stripRemote(controls.expandedView.priority) },
    board3d: { ...controls.board3d, priority: stripRemote(controls.board3d.priority) }
  };
}

export function loadImageSourceControls(): ImageSourceControls {
  try {
    const stored = localStorage.getItem(IMAGE_SOURCE_STORAGE_KEY);
    if (!stored) return DEFAULT_IMAGE_SOURCE_CONTROLS;
    const parsed = JSON.parse(stored) as Partial<ImageSourceControls>;
    return enforceRemoteToggle({
      cardLibrary: migrateLegacyPurposeControls(parsed.cardLibrary, DEFAULT_IMAGE_SOURCE_CONTROLS.cardLibrary),
      expandedView: migrateLegacyPurposeControls(parsed.expandedView, DEFAULT_IMAGE_SOURCE_CONTROLS.expandedView),
      board3d: migrateLegacyPurposeControls(parsed.board3d, DEFAULT_IMAGE_SOURCE_CONTROLS.board3d)
    });
  } catch {
    return enforceRemoteToggle(DEFAULT_IMAGE_SOURCE_CONTROLS);
  }
}

export function saveImageSourceControls(controls: ImageSourceControls): void {
  localStorage.setItem(IMAGE_SOURCE_STORAGE_KEY, JSON.stringify(controls));
  window.dispatchEvent(new CustomEvent("ward:image-source-controls-changed"));
}

export function subscribeImageSourceControls(listener: () => void): () => void {
  const eventName = "ward:image-source-controls-changed";
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener(eventName, listener);
  };
}
