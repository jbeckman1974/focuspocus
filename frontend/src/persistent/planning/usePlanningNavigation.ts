import { useCallback, useState } from "react";
import type { Catalog } from "./perspective.ts";
import { planningLinks } from "./links.ts";

type Page = "forecast" | "review" | "perspectives";

export function usePlanningNavigation(catalog: Catalog | undefined) {
  const [page, setPage] = useState<Page | null>(null);
  const close = useCallback(() => setPage(null), []);
  const [choice, setChoice] = useState("");
  const [selection, select] = useState<string[]>([]);
  const [visible, setVisible] = useState<string[]>([]);
  const [source, setSource] = useState<{ ids: string[]; selected: string[] }>({
    ids: [],
    selected: [],
  });
  const report = useCallback((ids: string[]) => {
    setVisible(ids);
    const matches = new Set(ids);
    select((old) =>
      old.every((id) => matches.has(id))
        ? old
        : old.filter((id) => matches.has(id)),
    );
  }, []);

  function open(
    target: string,
    outlineIds: string[],
    outlineSelection: string[],
  ) {
    const favorite = target.startsWith("saved-");
    if (
      !favorite &&
      target !== "forecast" &&
      target !== "review" &&
      target !== "perspectives"
    )
      return;
    const destination = favorite ? "perspectives" : (target as Page);
    const nextChoice = favorite ? target.slice(6) : "";
    if (page === destination && nextChoice === choice) return;
    if ((favorite || target === "perspectives") && page !== "perspectives") {
      setSource(
        page
          ? { ids: visible, selected: selection }
          : { ids: outlineIds, selected: outlineSelection },
      );
    }
    setChoice(nextChoice);
    setPage(destination);
    select([]);
    setVisible([]);
  }

  const active =
    page === "perspectives" &&
    catalog?.perspectives.some((p) => p.id === choice && p.favorite)
      ? "saved-" + choice
      : page;
  return {
    page,
    choice,
    setChoice,
    selection,
    select,
    report,
    source,
    open,
    close,
    active,
    links: planningLinks(catalog),
  };
}
export type PlanningNavigation = ReturnType<typeof usePlanningNavigation>;
