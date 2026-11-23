import { Button, Toolbar, ToolbarButton } from "@fluentui/react-components";
import type { ReactNode, Ref } from "react";
import { Icon } from "./Icon.tsx";
import { WorkspaceMenu } from "./WorkspaceMenu.tsx";

interface Props {
  label?: string;
  accountControls?: ReactNode;
  compact: boolean;
  narrow: boolean;
  browseOpen: boolean;
  inspectorOpen: boolean;
  browseToggle: Ref<HTMLButtonElement>;
  inspectorToggle: Ref<HTMLButtonElement>;
  onBrowse: () => void;
  onInspector: () => void;
  onCapture: () => void;
}

export function WorkspaceToolbar(props: Props) {
  return (
    <header className="fp-command-bar">
      <div className="fp-command-identity">
        <span className="fp-app-mark">
          <Icon name="mark" size={21} />
        </span>
        <strong>FocusPocus</strong>
        <span className="fp-command-context" title={props.label}>
          {props.label ?? "Sample workspace"}
        </span>
      </div>
      <Toolbar aria-label="Workspace actions" className="fp-command-actions">
        {props.compact && (
          <ToolbarButton
            ref={props.browseToggle}
            aria-label="Browse"
            title="Browse"
            aria-expanded={props.browseOpen}
            aria-controls="workspace-navigation"
            icon={<Icon name="browse" />}
            onClick={props.onBrowse}
          >
            <span className="fp-command-label">Browse</span>
          </ToolbarButton>
        )}
        <Button
          appearance="primary"
          aria-label="Add task"
          title="Add task"
          icon={<Icon name="add" size={17} />}
          onClick={props.onCapture}
        >
          <span className="fp-command-label">Add task</span>
        </Button>
        <ToolbarButton
          ref={props.inspectorToggle}
          aria-label="Inspector"
          title="Inspector"
          aria-controls="task-inspector"
          aria-expanded={props.inspectorOpen}
          icon={<Icon name="inspector" />}
          onClick={props.onInspector}
        >
          <span className="fp-command-label">Inspector</span>
        </ToolbarButton>
      </Toolbar>
      {props.accountControls && (
        <WorkspaceMenu narrow={props.narrow}>
          {props.accountControls}
        </WorkspaceMenu>
      )}
    </header>
  );
}
