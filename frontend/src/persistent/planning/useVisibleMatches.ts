import { useLayoutEffect } from "react";

// Keep the current inspector during a background refresh. Prune its selection
// only when the server has returned the IDs for the new view.
export function useVisibleMatches(report: (ids: string[]) => void, ids: string[] | undefined) {
  useLayoutEffect(() => {
    if (ids) report(ids);
  }, [report, ids]);
}
