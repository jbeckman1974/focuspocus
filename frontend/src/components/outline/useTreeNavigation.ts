import { useId, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { adjacentId, extendRange, stillSelected } from "./controls.ts";
import type { TreeCursor } from "./controls.ts";

function revealRow(container: HTMLElement, rowId: string) {
  const row = document.getElementById(rowId);
  if (!row || !container.contains(row)) return;
  const viewport = container.getBoundingClientRect();
  const bounds = row.getBoundingClientRect();
  if (bounds.top < viewport.top) {
    container.scrollTop += bounds.top - viewport.top;
  } else if (bounds.bottom > viewport.bottom) {
    container.scrollTop += Math.min(
      bounds.bottom - viewport.bottom,
      bounds.top - viewport.top,
    );
  }
}

export function useTreeNavigation(
  identity: string,
  ids: string[],
  selected: string[],
  onSelect: (ids: string[]) => void,
  tree: RefObject<HTMLDivElement | null>,
) {
  const prefix = useId();
  const [activeByView, setActiveByView] = useState<Record<string, TreeCursor>>(
    {},
  );
  const remembered = activeByView[identity];
  const active =
    remembered &&
    stillSelected(remembered, selected) &&
    ids.includes(remembered.id)
      ? remembered.id
      : (selected.find((id) => ids.includes(id)) ?? ids[0]);
  const rowId = (id: string) => `${prefix}-${id}`;

  useLayoutEffect(() => {
    if (tree.current && document.activeElement === tree.current && active) {
      revealRow(tree.current, `${prefix}-${active}`);
    }
  }, [identity, active, prefix, tree]);

  function select(id: string, extend = false, toggle = false) {
    let next: TreeCursor;
    if (extend) {
      next = extendRange(ids, remembered, selected, active, id);
    } else {
      const selection = toggle
        ? selected.includes(id)
          ? selected.filter((previous) => previous !== id)
          : [...selected, id]
        : [id];
      next = { id, anchor: id, selection };
    }
    setActiveByView((previous) => ({ ...previous, [identity]: next }));
    onSelect(next.selection);
    tree.current?.focus({ preventScroll: true });
    if (tree.current) revealRow(tree.current, rowId(id));
  }

  function navigate(
    key: "ArrowUp" | "ArrowDown" | "Home" | "End",
    extend: boolean,
  ) {
    const id = adjacentId(ids, active ?? "", key);
    if (id) select(id, extend);
  }

  return {
    active,
    rowId,
    select,
    navigate,
    clearSelection() {
      if (active) {
        setActiveByView((previous) => ({
          ...previous,
          [identity]: { id: active, anchor: active, selection: [] },
        }));
      }
      onSelect([]);
    },
    revealActive() {
      if (tree.current && active) revealRow(tree.current, rowId(active));
    },
  };
}
