import { useEffect, useRef, useState } from "react";
import type { Entry } from "../../outline/index.ts";
import { newDefinition } from "./perspective.ts";
import type { SaveBody } from "./perspective.ts";
import { PerspectiveEditor } from "./PerspectiveEditor.tsx";
import type { PlanningSession } from "./read.ts";
import { usePlanningRead } from "./read.ts";
import { QueryNotice, ResultList } from "./results.tsx";
import { useVisibleMatches } from "./useVisibleMatches.ts";
import type { ResultActions, ViewActions } from "./results.tsx";
import type { CatalogActions } from "./useCatalog.ts";

type SearchScope = "here" | "remaining" | "everything";
const searchTypingDelayMs = 60;
interface Result {
  rows: (Entry & { context?: boolean })[];
  matchIds: string[];
  count: number;
  groups: { key: string; label: string; ids: string[] }[];
}
function ContextRows({
  result,
  ...actions
}: ResultActions & { result: Result }) {
  const entries = new Map(result.rows.map((row) => [row.id, row]));
  const depth = new Map<string, number>();
  for (const row of result.rows)
    depth.set(
      row.id,
      row.parentId && depth.has(row.parentId)
        ? depth.get(row.parentId)! + 1
        : 0,
    );
  return (
    <ul className="planning-context">
      {result.rows.map((row) => (
        <li
          key={row.id}
          style={{
            paddingInlineStart: `${Math.min(depth.get(row.id) ?? 0, 20) * 1.1}em`,
          }}
        >
          {row.context ? (
            <span>{row.title}</span>
          ) : (
            <ResultList {...actions} entries={entries} ids={[row.id]} />
          )}
        </li>
      ))}
    </ul>
  );
}
export function Perspectives({
  session,
  catalog,
  choice,
  setChoice,
  source,
  report,
  ...actions
}: ViewActions & {
  session: PlanningSession;
  catalog: CatalogActions;
  choice: string;
  setChoice: (id: string) => void;
  source: { ids: string[]; selected: string[] };
}) {
  const current = catalog.data?.perspectives.find(
    (entry) => entry.id === choice,
  );
  const [text, setText] = useState("");
  const [needle, setNeedle] = useState("");
  const [scope, setScope] = useState<SearchScope>("here");
  const [offset, setOffset] = useState(0);
  const [selectionFilter, setSelectionFilter] = useState<string[]>();
  const [editing, setEditing] = useState<{ initial: SaveBody; base: number }>();
  const [deleting, setDeleting] = useState(false);
  const searchTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  function search(value: string, event: Event) {
    setText(value);
    window.clearTimeout(searchTimer.current);
    function submit() {
      setNeedle(value);
      setOffset(0);
    }
    // Group adjacent keystrokes before starting a full workspace query.
    // Clear, paste and whole-field replacements can be submitted immediately.
    const keystroke =
      event instanceof InputEvent &&
      (event.inputType.startsWith("delete") ||
        (event.inputType === "insertText" && (event.data?.length ?? 0) <= 1) ||
        event.inputType === "insertCompositionText");
    if (value && keystroke) {
      searchTimer.current = window.setTimeout(submit, searchTypingDelayMs);
    } else {
      submit();
    }
  }
  useEffect(() => {
    setOffset(0);
    setDeleting(false);
  }, [choice, catalog.data?.personalVersion, scope]);
  const result = usePlanningRead<Result>(
    session,
    catalog.data ? "perspectives/query" : null,
    {
      ...(current ? { perspectiveId: current.id } : {}),
      ...(scope === "here" && !current ? { hereIds: source.ids } : {}),
      ...(scope === "here" && selectionFilter
        ? { hereIds: selectionFilter }
        : {}),
      text: needle,
      scope,
      offset,
      limit: 100,
      ...(session.zone ? { viewZone: session.zone } : {}),
    },
    catalog.data?.personalVersion,
  );
  const data = text === needle ? result.data : undefined;
  useVisibleMatches(report, data?.matchIds);
  const entries = new Map(data?.rows.map((row) => [row.id, row]));
  const edit = (initial: SaveBody) =>
    setEditing({ initial, base: catalog.data!.personalVersion });
  return (
    <section className="planning-page" aria-label="Perspectives">
      <h1>Perspectives</h1>
      <div className="planning-controls">
        <button
          disabled={!catalog.data || !!catalog.pending}
          onClick={() =>
            edit({
              id: crypto.randomUUID(),
              name: "",
              favorite: false,
              icon: "list",
              definition: newDefinition(),
            })
          }
        >
          New perspective
        </button>
        {current && (
          <>
            <button
              onClick={() =>
                edit({
                  ...current,
                  definition: structuredClone(current.definition),
                })
              }
              disabled={!!catalog.pending}
            >
              Edit perspective
            </button>
            <button
              onClick={() => setDeleting(true)}
              disabled={!!catalog.pending}
            >
              Delete perspective
            </button>
          </>
        )}
      </div>
      {deleting && current && (
        <div
          className="planning-actions"
          role="group"
          aria-label="Confirm deletion"
        >
          <span>Delete {current.name}?</span>
          <button
            disabled={!!catalog.pending}
            onClick={async () => {
              if (
                await catalog.save({
                  action: "delete",
                  payload: { id: current.id },
                })
              ) {
                setChoice("");
                setDeleting(false);
              }
            }}
          >
            Confirm delete
          </button>
          <button onClick={() => setDeleting(false)}>Cancel</button>
        </div>
      )}
      <div
        role="group"
        aria-label="Saved perspectives"
        className="planning-controls"
      >
        <button
          type="button"
          aria-pressed={!current}
          onClick={() => setChoice("")}
        >
          This outline
        </button>
        {catalog.data?.perspectives.map((entry) => (
          <button
            type="button"
            key={entry.id}
            aria-label={entry.name}
            aria-pressed={current?.id === entry.id}
            onClick={() => setChoice(entry.id)}
          >
            {entry.favorite ? "★ " : ""}
            {entry.name}
          </button>
        ))}
      </div>
      <div className="planning-controls">
        <label>
          Search tasks{" "}
          <input
            type="search"
            value={text}
            onChange={(e) => search(e.target.value, e.nativeEvent)}
          />
        </label>
        <label>
          Search scope{" "}
          <select
            aria-label="Search scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as SearchScope)}
          >
            <option value="here">Here</option>
            <option value="remaining">Remaining</option>
            <option value="everything">Everything</option>
          </select>
        </label>
        {scope === "here" && (
          <label>
            <input
              type="checkbox"
              checked={selectionFilter !== undefined}
              onChange={(e) => {
                setSelectionFilter(
                  e.target.checked
                    ? actions.selected.length
                      ? actions.selected
                      : source.selected
                    : undefined,
                );
                setOffset(0);
              }}
            />
            Selected rows only
          </label>
        )}
      </div>
      {editing && (
        <PerspectiveEditor
          key={editing.initial.id}
          {...editing}
          close={() => setEditing(undefined)}
          saved={setChoice}
          snapshot={session.snapshot}
          catalog={catalog}
        />
      )}
      <QueryNotice error={result.error} retry={result.retry} loading={!data} />
      {data && (
        <section aria-label="Search results">
          <p role="status">
            {data.count} {data.count === 1 ? "match" : "matches"}
          </p>
          {data.groups.length ? (
            data.groups.map((item) => (
              <section
                className="planning-group"
                aria-label={item.label}
                key={item.key}
              >
                <h2>{item.label}</h2>
                <ResultList {...actions} ids={item.ids} entries={entries} />
              </section>
            ))
          ) : current?.definition.presentation === "outline" ? (
            <ContextRows result={data} {...actions} />
          ) : (
            <ResultList {...actions} ids={data.matchIds} entries={entries} />
          )}
          {data.count > 100 && (
            <div className="planning-actions">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous page
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 100, data.count)}
              </span>
              <button
                disabled={offset + 100 >= data.count}
                onClick={() => setOffset(offset + 100)}
              >
                Next page
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
