import { API_BASE_URL } from "./config";

export type SignedImageItem = {
  key: string;
  url: string;
  expiresAt?: string;
};

export async function fetchSignedRailwayImageUrls(keys: string[]): Promise<Map<string, SignedImageItem>> {
  if (keys.length === 0) return new Map();
  try {
    const response = await fetch(`${API_BASE_URL}/api/card-images/sign`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys })
    });
    if (!response.ok) return new Map();
    const data = await response.json() as { items?: SignedImageItem[] };
    const items = Array.isArray(data.items) ? data.items : [];
    return new Map(items.map(item => [item.key, item]));
  } catch {
    return new Map();
  }
}

export function buildRailwayObjectKeyFromFileName(fileName: string): string {
  return fileName
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^card-images\//i, "");
}
