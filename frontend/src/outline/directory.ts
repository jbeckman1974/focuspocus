import type { Entry } from "./types.ts";

export type FolderEntry = Entry & {
  parentId?: string | null;
  position?: number;
};

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

