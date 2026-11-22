import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
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
  onAppearance: (settings: Partial<Appearance>) => void;
  editMode: EditMode;
  setEditMode: (value: EditMode) => void;
  onClose: () => void;
  onReset?: () => void;
}

export function Preferences({
  appearance,
  controls,
  onAppearance,
  editMode,
  setEditMode,
  onClose,
  onReset,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="fp-dialog"
      aria-labelledby="settings-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="fp-panel-heading">
        <h2 id="settings-heading">Workspace preferences</h2>
        <button
          type="button"
          className="fp-icon-button"
          aria-label="Close preferences"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="fp-dialog-fields">
        <label className="fp-field">
          Theme
          <select
            aria-label="Theme"
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
          </select>
        </label>
        <label className="fp-field">
          Row density
          <select
            aria-label="Row density"
            value={appearance.density}
            onChange={(event) =>
              onAppearance({
                density: event.currentTarget.value as Density,
              })
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="fp-field">
          Text size
          <select
            aria-label="Text size"
            value={appearance.textSize}
            onChange={(event) =>
              onAppearance({
                textSize: event.currentTarget.value as TextSize,
              })
            }
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className="fp-field">
          Edit titles in
          <select
            aria-label="Edit titles in"
            value={editMode}
            onChange={(event) =>
              setEditMode(event.currentTarget.value as EditMode)
            }
          >
            <option value="inline">Outline</option>
            <option value="inspector">Inspector</option>
          </select>
        </label>
        {controls}
      </div>
      <div className="fp-dialog-footer">
        <p>
          {onReset
            ? "Tasks and preferences last until you reset the sample or reload this tab."
            : "Your account saves appearance and editing choices. This browser keeps its own pane layout."}
        </p>
        {onReset && (
          <button
            type="button"
            className="fp-secondary"
            onClick={() => {
              dialog.current?.close();
              onReset();
            }}
          >
            <Icon name="reset" size={16} /> Reset sample
          </button>
        )}
      </div>
    </dialog>
  );
}
