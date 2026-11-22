import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { RowLayout } from "./rowLayout.ts";

interface Anchor {
  item?: string;
  offset: number;
  top: number;
}

function readAnchor(container: HTMLElement, layout?: RowLayout): Anchor {
  const top = container.scrollTop;
  if (layout) {
    const origin =
      container.firstElementChild!.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      top;
    const index = layout.indexAt(top - origin);
    return {
      item: layout.ids[index],
      offset: origin + layout.offsets[index] - top,
      top,
    };
  }
  const edge = container.getBoundingClientRect().top;
  const row = [
    ...container.querySelectorAll<HTMLElement>("[data-task-id]"),
  ].find((item) => item.getBoundingClientRect().bottom > edge);
  return {
    item: row?.dataset.taskId,
    offset: row ? row.getBoundingClientRect().top - edge : 0,
    top,
  };
}

function restoreAnchor(
  container: HTMLElement,
  layout: RowLayout | undefined,
  anchor?: Anchor,
) {
  if (anchor?.item) {
    const edge = container.getBoundingClientRect().top;
    const index = layout?.indices.get(anchor.item);
    if (layout && index !== undefined) {
      container.scrollTop +=
        container.firstElementChild!.getBoundingClientRect().top -
        edge +
        layout.offsets[index] -
        anchor.offset;
      return;
    }
    const row = [
      ...container.querySelectorAll<HTMLElement>("[data-task-id]"),
    ].find((item) => item.dataset.taskId === anchor.item);
    if (row) {
      container.scrollTop +=
        row.getBoundingClientRect().top - edge - anchor.offset;
      return;
    }
  }
  container.scrollTop = anchor?.top ?? 0;
}

export function useOutlineWindow(
  identity: string,
  ids: string[],
  tree: RefObject<HTMLDivElement | null>,
) {
  const enabled = ids.length > 100;
  const [measurements, setMeasurements] = useState(() => ({
    width: 0,
    estimate: 42,
    font: "",
    heights: new Map<string, number>(),
  }));
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const layout = useMemo(
    () =>
      enabled
        ? new RowLayout(ids, measurements.heights, measurements.estimate)
        : undefined,
    [enabled, ids, measurements],
  );
  const anchors = useRef(new Map<string, Anchor>());
  const last = useRef<{
    identity: string;
    layout?: RowLayout;
    ready: boolean;
  } | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const mounted = useRef(new Set<HTMLElement>());

  const observe = useCallback((row: HTMLDivElement | null) => {
    if (!row) return;
    mounted.current.add(row);
    observer.current?.observe(row);
    return () => {
      mounted.current.delete(row);
      observer.current?.unobserve(row);
    };
  }, []);

  const updateViewport = useCallback((container: HTMLElement) => {
    const top = container.scrollTop;
    const height = container.clientHeight;
    setViewport((previous) =>
      previous.top === top && previous.height === height
        ? previous
        : { top, height },
    );
  }, []);

  useLayoutEffect(() => {
    const container = tree.current;
    if (!container || !enabled) return;
    const measure = () => {
      const first = mounted.current.values().next().value;
      if (!first || !container.clientWidth || !container.clientHeight) return;
      const style = getComputedStyle(first);
      const width = container.clientWidth;
      const estimate = parseFloat(style.minHeight) || 42;
      const font = style.fontSize + " " + style.fontFamily;
      const sizes = [...mounted.current].map(
        (row) =>
          [row.dataset.taskId!, row.getBoundingClientRect().height] as const,
      );
      setMeasurements((previous) => {
        const reset =
          previous.width !== width ||
          previous.estimate !== estimate ||
          previous.font !== font;
        let heights = reset ? new Map<string, number>() : previous.heights;
        for (const [id, size] of sizes) {
          if (size <= 0 || size === (heights.get(id) ?? estimate)) continue;
          if (heights === previous.heights) heights = new Map(heights);
          if (size === estimate) heights.delete(id);
          else heights.set(id, size);
        }
        return heights === previous.heights
          ? previous
          : { width, estimate, font, heights };
      });
      updateViewport(container);
    };
    observer.current = new ResizeObserver(measure);
    observer.current.observe(container);
    for (const row of mounted.current) observer.current.observe(row);
    measure();
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [tree, enabled, updateViewport]);

  useLayoutEffect(() => {
    const container = tree.current;
    if (!container) return;
    const previous = last.current;
    const ready = ids.length > 0;
    if (
      ready &&
      (previous?.identity !== identity ||
        !previous.ready ||
        previous.layout !== layout)
    ) {
      restoreAnchor(container, layout, anchors.current.get(identity));
      if (container.clientHeight)
        anchors.current.set(identity, readAnchor(container, layout));
    }
    last.current = { identity, layout, ready };
    if (layout) updateViewport(container);
  }, [tree, identity, ids, layout, updateViewport]);

  function onScroll() {
    const container = tree.current;
    if (!container || !ids.length || !container.clientHeight) return;
    anchors.current.set(identity, readAnchor(container, layout));
    if (layout) updateViewport(container);
  }
  return { layout, viewport, observe: enabled ? observe : undefined, onScroll };
}
