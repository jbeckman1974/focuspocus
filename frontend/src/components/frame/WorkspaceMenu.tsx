import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export function WorkspaceMenu({
  narrow,
  children,
}: {
  narrow: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!narrow) return;
    const element = menu.current;
    if (element?.querySelector("dialog[open]")) setExpanded(true);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !element?.contains(event.target) &&
        !element?.querySelector("dialog[open]")
      )
        setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [narrow]);
  return (
    <details
      ref={menu}
      className="fp-workspace-menu"
      open={!narrow || expanded}
      onKeyDown={(event) => {
        if (
          narrow &&
          expanded &&
          event.key === "Escape" &&
          !menu.current?.querySelector("dialog[open]")
        ) {
          event.preventDefault();
          setExpanded(false);
          summary.current?.focus();
        }
      }}
    >
      <summary
        ref={summary}
        aria-label="Workspace"
        title="Workspace"
        onClick={(event) => {
          event.preventDefault();
          if (narrow) setExpanded((current) => !current);
        }}
      >
        <Icon name="projects" size={18} />
        <span>Workspace</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}
