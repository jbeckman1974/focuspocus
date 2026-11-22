import type { View } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import type { OutlineResult } from "./rules.ts";

export function DirectoryLinks({
  snapshot,
  view,
  result,
  choose,
}: {
  snapshot: Snapshot;
  view: View;
  result?: OutlineResult;
  choose: (view: View) => void;
}) {
  if (view.kind === "tags") {
    return (
      <nav className="directory-links" aria-label="Browse tags">
        {snapshot.tags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => choose({ kind: "tag", id: tag.id })}
          >
            {tag.title}
          </button>
        ))}
      </nav>
    );
  }
  if (!result || (view.kind !== "projects" && view.kind !== "folder"))
    return null;
  const root = view.kind === "folder" ? view.id : "root";
  const containers = result.rows.filter(
    (row) =>
      row.parentId === root &&
      (row.kind === "project" || row.kind === "folder"),
  );
  return (
    <nav className="directory-links" aria-label="Browse project outline">
      {containers.map((row) => (
        <button
          key={row.id}
          onClick={() =>
            choose({
              kind: row.kind === "folder" ? "folder" : "project",
              id: row.id,
            })
          }
        >
          {row.title}
        </button>
      ))}
    </nav>
  );
}
