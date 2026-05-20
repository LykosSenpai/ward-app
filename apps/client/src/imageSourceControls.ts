export type ImagePurposeKey = "cardLibrary" | "expandedView" | "board3d";
export type ImageSourceKey = "excelRemote" | "githubCdn" | "railwayBucket" | "localBundled" | "placeholder";

export type ImageSourceControls = {
  cardLibrary: { scale: number; priority: ImageSourceKey[] };
  expandedView: { scale: number; priority: ImageSourceKey[] };
  board3d: { scale: number; priority: ImageSourceKey[] };
};

export const IMAGE_SOURCE_STORAGE_KEY = "ward:image-source-controls:v1";
export const IMAGE_SOURCE_OPTIONS: Array<{ value: ImageSourceKey; label: string }> = [
  { value: "excelRemote", label: "Excel/Wix Remote" },
  { value: "githubCdn", label: "GitHub CDN" },
  { value: "railwayBucket", label: "Railway Bucket (Signed URL)" },
  { value: "localBundled", label: "Local Bundled (/card-images)" },
  { value: "placeholder", label: "Placeholder" }
];

export const DEFAULT_IMAGE_SOURCE_CONTROLS: ImageSourceControls = {
  cardLibrary: { scale: 960, priority: ["excelRemote", "githubCdn", "railwayBucket", "localBundled", "placeholder"] },
  expandedView: { scale: 1440, priority: ["excelRemote", "githubCdn", "railwayBucket", "localBundled", "placeholder"] },
  board3d: { scale: 720, priority: ["excelRemote", "githubCdn", "railwayBucket", "localBundled", "placeholder"] }
};

export function loadImageSourceControls(): ImageSourceControls {
  try {
    const stored = localStorage.getItem(IMAGE_SOURCE_STORAGE_KEY);
    if (!stored) return DEFAULT_IMAGE_SOURCE_CONTROLS;
    const parsed = JSON.parse(stored) as Partial<ImageSourceControls>;
    return {
      cardLibrary: parsed.cardLibrary ?? DEFAULT_IMAGE_SOURCE_CONTROLS.cardLibrary,
      expandedView: parsed.expandedView ?? DEFAULT_IMAGE_SOURCE_CONTROLS.expandedView,
      board3d: parsed.board3d ?? DEFAULT_IMAGE_SOURCE_CONTROLS.board3d
    };
  } catch {
    return DEFAULT_IMAGE_SOURCE_CONTROLS;
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
