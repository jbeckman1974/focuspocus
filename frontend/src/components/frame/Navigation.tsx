import type { View, Workspace } from "../../outline/index.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";

interface NavigationProps {
  workspace: Workspace;
  view: View;
  onView: (view: View) => void;
  onPreferences: () => void;
}

function isCurrent(view: View, target: View): boolean {
  return (
    view.kind === target.kind &&
    (!("id" in target) || ("id" in view && view.id === target.id))
  );
}

export function Rail({
  workspace,
  view,
  onView,
  onPreferences,
}: NavigationProps) {
  const links: { label: string; icon: IconName; target: View }[] = [
    { label: "Inbox", icon: "inbox", target: { kind: "inbox" } },
  ];
  const project = workspace.projects[0];
  const tag = workspace.tags[0];
  if (project)
    links.push({
      label: "Projects",
      icon: "projects",
      target: { kind: "project", id: project.id },
    });
  if (tag)
    links.push({
      label: "Tags",
      icon: "tags",
      target: { kind: "tag", id: tag.id },
    });
  links.push({ label: "All tasks", icon: "all", target: { kind: "all" } });

  return (
    <nav className="fp-rail" aria-label="Perspectives">
      <div className="fp-rail-links">
        {links.map(({ label, icon, target }) => (
          <button
            key={label}
            type="button"
            className="fp-rail-button"
            aria-current={view.kind === target.kind ? "page" : undefined}
            onClick={() => onView(view.kind === target.kind ? view : target)}
          >
            <Icon name={icon} size={21} />
            {label}
          </button>
        ))}
      </div>
      <button
        className="fp-rail-button"
        type="button"
        aria-label="Preferences"
        title="Preferences"
        onClick={onPreferences}
      >
        <Icon name="preferences" size={21} />
      </button>
    </nav>
  );
}

interface SidebarProps extends NavigationProps {
  compact: boolean;
  onClose: () => void;
}

export function Sidebar({
  workspace,
  view,
  onView,
  compact,
  onClose,
  onPreferences,
}: SidebarProps) {
  const link = (label: string, icon: IconName, target: View) => (
    <button
      key={target.kind + ("id" in target ? target.id : "")}
      type="button"
      className="fp-nav-link"
      aria-label={label}
      aria-current={isCurrent(view, target) ? "page" : undefined}
      onClick={() => onView(target)}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );

  return (
    <nav
      className="fp-sidebar"
      aria-label="Workspace navigation"
      id="workspace-navigation"
    >
      <div className="fp-panel-heading">
        <h2>Browse</h2>
        {compact && (
          <button
            type="button"
            className="fp-icon-button"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="fp-nav-sections">
        {compact && (
          <section aria-label="Perspectives">
            <h3>Perspectives</h3>
            {link("Inbox", "inbox", { kind: "inbox" })}
            {link("All tasks", "all", { kind: "all" })}
          </section>
        )}
        <section aria-label="Projects">
          <h3>Projects</h3>
          {workspace.projects.map((project) =>
            link(project.title, "projects", {
              kind: "project",
              id: project.id,
            }),
          )}
        </section>
        <section aria-label="Tags">
          <h3>Tags</h3>
          {workspace.tags.map((tag) =>
            link(tag.title, "tags", { kind: "tag", id: tag.id }),
          )}
        </section>
      </div>
      {compact && (
        <button
          type="button"
          className="fp-secondary fp-mobile-settings"
          onClick={onPreferences}
        >
          <Icon name="preferences" size={16} /> Preferences
        </button>
      )}
    </nav>
  );
}
