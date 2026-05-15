import type { EmbedPage, EmbedView } from "./embedTypes";

export type PlayViewMode = "board3d";

export function parseRequestedEmbedView(search: string): PlayViewMode | null {
  const requestedView = new URLSearchParams(search).get("view");
  if (requestedView === "board" || requestedView === "split" || requestedView === "text" || requestedView === "board3d" || requestedView === "board-3d" || requestedView === "3d") {
    return "board3d";
  }
  return null;
}

export function canApplyEmbedPage(page: string): page is EmbedPage {
  return page === "play" || page === "board-preview";
}

export function canApplyEmbedView(view: string): view is EmbedView {
  return view === "board" || view === "split" || view === "text";
}
