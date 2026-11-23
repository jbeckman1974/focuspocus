import type { View, Workspace } from "../../outline/index.ts";
import { directoryRows } from "../../outline/directory.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";

export interface PlanningLink {
  id: string;
  label: string;
  icon: IconName;
}
export interface PlanningNavigation {
  active: string | null;
  links: PlanningLink[];
  open: (id: string) => void;
}
interface NavigationProps {
  planning?: PlanningNavigation;
  standardViews?: boolean;
  workspace: Workspace;
  view: View;
  onView: (view: View) => void;
  onPreferences: (trigger: HTMLElement) => void;
}

function isCurrent(view: View, target: View): boolean {
  return (
    view.kind === target.kind &&
    (!("id" in target) || ("id" in view && view.id === target.id))
  );
}

const perspectives = [
  { label: "Projects", icon: "projects", target: { kind: "projects" } },
  { label: "Tags", icon: "tags", target: { kind: "tags" } },
  { label: "Flagged", icon: "flag", target: { kind: "flagged" } },
  { label: "Completed", icon: "complete", target: { kind: "completed" } },
  { label: "Changed", icon: "changed", target: { kind: "changed" } },
] as const;

export function Rail({
  standardViews,
  planning,
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
  if (standardViews) links.push(...perspectives);
  if (!standardViews && project)
    links.push({
      label: "Projects",
      icon: "projects",
      target: { kind: "project", id: project.id },
    });
  if (!standardViews && tag)
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
            aria-current={
              !planning?.active && view.kind === target.kind
                ? "page"
                : undefined
            }
            onClick={() => onView(view.kind === target.kind ? view : target)}
          >
            <Icon name={icon} size={21} />
            {label}
          </button>
        ))}
        {planning?.links.map((item) => (
          <button
            key={item.id}
            type="button"
            className="fp-rail-button"
            aria-label={item.label}
            aria-current={planning.active === item.id ? "page" : undefined}
            onClick={() => planning.open(item.id)}
          >
            <Icon name={item.icon} size={21} />
            {item.label}
          </button>
        ))}
      </div>
      <button
        className="fp-rail-button"
        type="button"
        aria-label="Preferences"
        title="Preferences"
        onClick={(event) => onPreferences(event.currentTarget)}
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
  standardViews,
  planning,
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
      aria-current={
        !planning?.active && isCurrent(view, target) ? "page" : undefined
      }
      onClick={() => onView(target)}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );

  const directory = directoryRows(
    [
      ...(workspace.folders ?? []).map((folder) => ({
        ...folder,
        kind: "folder" as const,
      })),
      ...workspace.projects.map((project) => ({
        ...project,
        kind: "project" as const,
      })),
    ],
    "root",
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
            {standardViews &&
              perspectives.map((p) => link(p.label, p.icon, p.target))}
            {link("All tasks", "all", { kind: "all" })}
            {planning?.links.map((item) => (
              <button
                key={item.id}
                type="button"
                className="fp-nav-link"
                aria-label={item.label}
                aria-current={planning.active === item.id ? "page" : undefined}
                onClick={() => planning.open(item.id)}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            ))}
          </section>
        )}
        <section aria-label="Projects">
          <h3>Projects</h3>
          {directory.map(({ entry, depth }) => (
            <div
              key={entry.id}
              style={{ paddingInlineStart: Math.min(depth, 8) * 12 }}
            >
              {link(entry.title, "projects", {
                kind: entry.kind,
                id: entry.id,
              })}
            </div>
          ))}
        </section>
        <section aria-label="Tags">
          <h3>Tags</h3>
          {directoryRows(workspace.tags, null).map(({ entry, depth }) => (
            <div
              key={entry.id}
              style={{ paddingInlineStart: Math.min(depth, 8) * 12 }}
            >
              {link(entry.title, "tags", { kind: "tag", id: entry.id })}
            </div>
          ))}
        </section>
      </div>
      {compact && (
        <button
          type="button"
          className="fp-secondary fp-mobile-settings"
          onClick={(event) => onPreferences(event.currentTarget)}
        >
          <Icon name="preferences" size={16} /> Preferences
        </button>
      )}
    </nav>
  );
}
