import type { Appearance, EditMode } from "../../components/frame/Preferences.tsx";
import type { DateDefaults } from "../schedule.ts";

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
  dateDefaults?: Partial<DateDefaults>;
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
