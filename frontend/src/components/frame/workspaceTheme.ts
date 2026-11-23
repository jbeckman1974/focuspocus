import { useSyncExternalStore } from "react";
import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
} from "@fluentui/react-components";
import type { Appearance } from "./Preferences.tsx";

const brand: BrandVariants = {
  10: "#071c14",
  20: "#0e2a20",
  30: "#14382a",
  40: "#184633",
  50: "#1c503c",
  60: "#205c45",
  70: "#24654d",
  80: "#297456",
  90: "#378464",
  100: "#489573",
  110: "#5ca686",
  120: "#72b699",
  130: "#8bc6ab",
  140: "#a6d5bd",
  150: "#c1e4d1",
  160: "#dff1e5",
};

const light = createLightTheme(brand);
const dark = createDarkTheme(brand);
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
  return choice === "dark" || (choice === "system" && systemDark)
    ? dark
    : light;
}
