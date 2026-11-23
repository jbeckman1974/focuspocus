import { useEffect, useSyncExternalStore } from "react";
import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
} from "@fluentui/react-components";
import type { Appearance } from "./Preferences.tsx";

const brand: BrandVariants = {
  10: "#1c102b",
  20: "#301940",
  30: "#422155",
  40: "#502668",
  50: "#5f2c80",
  60: "#6d3198",
  70: "#7838ac",
  80: "#8243c2",
  90: "#9659ce",
  100: "#af7bdf",
  110: "#bf92e8",
  120: "#cda8ee",
  130: "#d9bcf3",
  140: "#e5cff6",
  150: "#f0e0fb",
  160: "#f9f2fe",
};

const light = { theme: createLightTheme(brand), colorScheme: "light" } as const;
const dark = { theme: createDarkTheme(brand), colorScheme: "dark" } as const;
const query = "(prefers-color-scheme: dark)";

function subscribeSystemTheme(change: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

const systemIsDark = () => window.matchMedia(query).matches;

export function useWorkspaceTheme(choice: Appearance["theme"]) {
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    systemIsDark,
    () => false,
  );
  useEffect(() => {
    if (choice === "system") return;
    const source = document.querySelector<HTMLMetaElement>(
      `meta[name="theme-color"][data-scheme="${choice}"]`,
    );
    if (!source) return;
    const override = document.createElement("meta");
    override.name = "theme-color";
    override.content = source.content;
    document.head.prepend(override);
    return () => override.remove();
  }, [choice]);
  return choice === "dark" || (choice === "system" && systemDark)
    ? dark
    : light;
}
