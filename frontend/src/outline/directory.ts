import { INBOX, type Entry, type Workspace } from "./types.ts";

export type FolderEntry = Entry & {
  parentId?: string | null;
  position?: number;
};

/** Keep ordinary project labels short and distinguish repeated names by their folder path. */
export function projectLocations(
  workspace: Pick<Workspace, "projects" | "folders">,
): Map<string, Entry> {
  const inbox = { id: INBOX, title: "Inbox" };
  const locations = new Map([[INBOX, inbox]]);
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const project of workspace.projects) {
    locations.set(
      project.id,
      project.title === inbox.title
        ? { ...project, title: "Inbox (project)" }
        : project,
    );
    if (seen.has(project.title)) repeated.add(project.title);
    seen.add(project.title);
  }
  if (!repeated.size) return locations;

  const folders = new Map(
    numberedChoices(workspace.folders ?? [], true).map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const projects = numberedChoices(workspace.projects, true);
  for (const [index, project] of workspace.projects.entries()) {
    if (!repeated.has(project.title)) continue;
    const parts = [projects[index].title];
    const visited = new Set<string>();
    let parent = project.parentId;
    while (parent && folders.has(parent) && !visited.has(parent)) {
      visited.add(parent);
      const folder = folders.get(parent)!;
      parts.push(folder.title);
      parent = folder.parentId;
    }
    if (parts.length > 1 || parts[0] !== project.title)
      locations.set(project.id, {
        ...project,
        title: parts.reverse().join(" / "),
      });
  }
  return locations;
}

export function directoryRows<T extends FolderEntry>(
  entries: T[],
  root: string | null,
): { entry: T; depth: number }[] {
  const children = new Map<string | null, T[]>();
  for (const entry of entries) {
    const parentId = entry.parentId ?? root;
    const siblings = children.get(parentId) ?? [];
    siblings.push(entry);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  const stack = (children.get(root) ?? [])
    .map((entry) => ({ entry, depth: 0 }))
    .reverse();
  const result: { entry: T; depth: number }[] = [];
  while (stack.length) {
    const row = stack.pop()!;
    result.push(row);
    const nested = children.get(row.entry.id) ?? [];
    for (let i = nested.length - 1; i >= 0; i--)
      stack.push({ entry: nested[i]!, depth: row.depth + 1 });
  }
  return result;
}

/** Distinguish repeated option labels in manual order while retaining their IDs. */
export function numberedChoices<T extends Entry>(
  entries: readonly T[],
  byParent = false,
): T[] {
  const names = new Map<string, T[]>();
  for (const entry of entries) {
    const key = byParent
      ? JSON.stringify([entry.parentId, entry.title])
      : entry.title;
    const siblings = names.get(key);
    if (siblings) siblings.push(entry);
    else names.set(key, [entry]);
  }
  const titles = new Map<string, string>();
  for (const siblings of names.values()) {
    if (siblings.length > 1)
      siblings.forEach((entry, index) =>
        titles.set(
          entry.id,
          `${entry.title} (${index + 1} of ${siblings.length})`,
        ),
      );
  }
  return entries.map((entry) =>
    titles.has(entry.id) ? { ...entry, title: titles.get(entry.id)! } : entry,
  );
}
