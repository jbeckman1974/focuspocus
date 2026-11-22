import type { Appearance, EditMode } from "../../components/frame/Preferences.tsx";
import { dateFields } from "../schedule.ts";
import type { DateDefaults, DateField } from "../schedule.ts";

export interface AccountSettings extends Appearance {
  editMode: EditMode;
  motion: "system" | "reduced";
  shortcut: "x" | "c" | "k";
  dateDefaults: DateDefaults;
}
export interface DeviceSettings {
  sidebarSize: number;
  inspectorSize: number;
  inspectorOpen: boolean | null;
}
export type AccountPatch = Partial<Omit<AccountSettings, "dateDefaults">> & {
  dateDefaults?: Partial<Record<DateField, string | null>>;
};

export interface PersonalSettings {
  account: AccountSettings;
  device: DeviceSettings;
  setAccount: (patch: AccountPatch) => void;
  setDevice: (patch: Partial<DeviceSettings>) => void;
  message: string;
  retry?: () => void;
  discard?: () => void;
}

export const initialAccount: AccountSettings = {
  theme: "system", density: "comfortable", textSize: "standard",
  motion: "system", editMode: "inline", shortcut: "x",
  dateDefaults: { defer: "00:00", planned: "00:00", due: "17:00" },
};
export const initialDevice: DeviceSettings = {
  sidebarSize: 212, inspectorSize: 260, inspectorOpen: null,
};

export function mergeAccountChanges(old: AccountPatch, patch: AccountPatch): AccountPatch {
  return patch.dateDefaults
    ? { ...old, ...patch, dateDefaults: { ...old.dateDefaults, ...patch.dateDefaults } }
    : { ...old, ...patch };
}

export function applyAccountChanges(old: AccountSettings, patch: AccountPatch): AccountSettings {
  const { dateDefaults: clocks, ...choices } = patch;
  if (!clocks) return { ...old, ...choices };
  const dateDefaults = { ...old.dateDefaults };
  for (const field of dateFields) {
    const clock = clocks[field];
    // The server returns the effective workspace clock after removing an override.
    if (clock != null) dateDefaults[field] = clock;
  }
  return { ...old, ...choices, dateDefaults };
}
