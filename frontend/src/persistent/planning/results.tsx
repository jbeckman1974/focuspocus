import type { Entry } from "../../outline/index.ts";

interface Props {
  ids: string[];
  entries: ReadonlyMap<string, Entry>;
  selected: string[];
  select: (ids: string[]) => void;
  open: (id: string) => void;
}
export type ResultActions = Pick<Props, "selected" | "select" | "open">;

export type ViewActions = ResultActions & { report: (ids: string[]) => void };

export function ResultList({ ids, entries, selected, select, open }: Props) {
  return (
    <ul className="planning-results">
      {ids.map((id) => {
        const entry = entries.get(id);
        if (!entry) return null;
        const chosen = selected.includes(id);
        return (
          <li key={id}>
            <button
              type="button"
              aria-pressed={chosen}
              data-item-id={id}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey)
                  select(
                    chosen
                      ? selected.filter((item) => item !== id)
                      : [...selected, id],
                  );
                else select([id]);
              }}
              onDoubleClick={() => open(id)}
            >
              {entry.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function QueryNotice({
  error,
  retry,
  loading,
}: {
  error?: string;
  retry: () => void;
  loading: boolean;
}) {
  if (error)
    return (
      <p role="alert">
        {error} <button onClick={retry}>Retry</button>
      </p>
    );
  if (loading) return <p role="status">Loading…</p>;
  return null;
}
