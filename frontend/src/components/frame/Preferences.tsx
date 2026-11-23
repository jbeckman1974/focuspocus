import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Select,
} from "@fluentui/react-components";
import { useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

type Theme = "system" | "light" | "dark";
type Density = "comfortable" | "compact";
type TextSize = "standard" | "large";
export type EditMode = "inline" | "inspector";

export interface Appearance {
  theme: Theme;
  density: Density;
  textSize: TextSize;
}

interface Props {
  controls?: ReactNode;
  appearance: Appearance;
  colorScheme: "light" | "dark";
  motion: "system" | "reduced";
  onAppearance: (settings: Partial<Appearance>) => void;
  editMode: EditMode;
  setEditMode: (value: EditMode) => void;
  onClose: () => void;
  onReset?: () => void;
}

export function Preferences({
  appearance,
  colorScheme,
  motion,
  controls,
  onAppearance,
  editMode,
  setEditMode,
  onClose,
  onReset,
}: Props) {
  // Replacing the entrance animation while the dialog is open would remount the focused control.
  const [reduceEntranceMotion] = useState(motion === "reduced");
  return (
    <Dialog
      open
      surfaceMotion={reduceEntranceMotion ? null : undefined}
      onOpenChange={(_, state) => {
        if (!state.open) onClose();
      }}
    >
      <DialogSurface
        className="fp-preferences"
        style={{ colorScheme }}
        data-color-scheme={colorScheme}
        backdropMotion={reduceEntranceMotion ? null : undefined}
        data-text-size={appearance.textSize}
        data-motion={motion}
      >
        <DialogBody>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                icon={<Icon name="close" />}
                aria-label="Close preferences"
                onClick={onClose}
              />
            }
          >
            <span className="fp-title-with-icon">
              <Icon name="preferences" size={26} /> Workspace preferences
            </span>
          </DialogTitle>
          <DialogContent className="fp-preferences-content">
            <section
              className="fp-preference-section"
              aria-labelledby="appearance-heading"
            >
              <h3 id="appearance-heading">Appearance and editing</h3>
              <div className="fp-preference-grid">
                <Field label="Theme">
                  <Select
                    value={appearance.theme}
                    onChange={(event) =>
                      onAppearance({
                        theme: event.currentTarget.value as Theme,
                      })
                    }
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </Select>
                </Field>
                <Field label="Row density">
                  <Select
                    value={appearance.density}
                    onChange={(event) =>
                      onAppearance({
                        density: event.currentTarget.value as Density,
                      })
                    }
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </Select>
                </Field>
                <Field label="Text size">
                  <Select
                    value={appearance.textSize}
                    onChange={(event) =>
                      onAppearance({
                        textSize: event.currentTarget.value as TextSize,
                      })
                    }
                  >
                    <option value="standard">Standard</option>
                    <option value="large">Large</option>
                  </Select>
                </Field>
                <Field label="Edit titles in">
                  <Select
                    value={editMode}
                    onChange={(event) =>
                      setEditMode(event.currentTarget.value as EditMode)
                    }
                  >
                    <option value="inline">Outline</option>
                    <option value="inspector">Inspector</option>
                  </Select>
                </Field>
              </div>
            </section>
            {controls}
          </DialogContent>
          <DialogActions className="fp-preferences-footer" position="start">
            <p>
              {onReset
                ? "Sample tasks and settings reset when you reload."
                : "Your account saves these choices. Pane sizes are saved on this device."}
            </p>
            <div>
              {onReset && (
                <Button
                  appearance="subtle"
                  icon={<Icon name="reset" size={16} />}
                  onClick={onReset}
                >
                  Reset sample
                </Button>
              )}
              <Button appearance="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
