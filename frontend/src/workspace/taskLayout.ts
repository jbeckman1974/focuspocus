import { useSyncExternalStore } from "react";

export const taskLayouts = ["list", "board", "calendar"] as const;
export type TaskLayout = (typeof taskLayouts)[number];

function readLayout(): TaskLayout {
  const fragment = window.location.hash.slice(1);
  return taskLayouts.find((layout) => layout === fragment) ?? "list";
}

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

// A bookmark records the presentation without putting task or account data in the URL.
export function useTaskLayout() {
  return useSyncExternalStore(subscribe, readLayout, () => "list" as const);
}

export function chooseTaskLayout(layout: TaskLayout) {
  if (readLayout() !== layout) window.location.hash = layout;
}
