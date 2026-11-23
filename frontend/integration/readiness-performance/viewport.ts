export interface FixtureRow {
  id: string;
  title: string;
}

type ViewportCheck = (
  kind: "outline" | "search",
  clip: HTMLElement,
  list: HTMLElement,
  expected: readonly FixtureRow[],
) => number;

export type ViewportWindow = Window & { benchmarkViewport?: ViewportCheck };

// Playwright installs this function in the browser before sign-in. The seed fixture
// provides identities and titles. Only geometry comes from the running application.
export function installViewportCheck() {
  (window as ViewportWindow).benchmarkViewport = (
    kind,
    clip,
    list,
    expected,
  ) => {
    const box = clip.getBoundingClientRect();
    const top = Math.max(0, box.top + clip.clientTop);
    const bottom = Math.min(
      innerHeight,
      box.top + clip.clientTop + clip.clientHeight,
    );
    const content = list.getBoundingClientRect();
    if (clip.scrollTop !== 0 || content.top < top - 1 || content.top >= bottom)
      return 0;

    const outline = kind === "outline";
    const rows = list.querySelectorAll<HTMLElement>(
      outline ? '[role="treeitem"]' : "button",
    );
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    let previousBottom = content.top;
    let previousMargin = 0;
    let visible = 0;
    let below = false;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (below) {
        // Virtualization can pin another row after the contiguous first window.
        if (rect.bottom > top && rect.top < bottom) return 0;
        continue;
      }
      const fixture = expected[visible];
      const title = outline ? row.querySelector(".outline-title") : row;
      if (
        !fixture ||
        !title ||
        title.textContent !== fixture.title ||
        (outline ? row.dataset.taskId : row.dataset.itemId) !== fixture.id ||
        (outline && row.getAttribute("aria-label") !== fixture.title) ||
        rect.height <= 0 ||
        rect.width <= 0 ||
        rect.right <= Math.max(0, box.left) ||
        rect.left >= Math.min(innerWidth, box.right)
      )
        return 0;

      // Outline rows abut. Search list items have CSS margins that collapse.
      // A missing tail, gap or overlap cannot qualify as a filled viewport.
      const style = getComputedStyle(outline ? row : row.parentElement!);
      const margin = Math.max(previousMargin, parseFloat(style.marginTop) || 0);
      const space = rect.top - previousBottom;
      if (space < -1 || space > gap + margin + 1) return 0;
      if (rect.top >= bottom) {
        below = true;
        continue;
      }
      if (
        !title.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        })
      )
        return 0;
      previousBottom = rect.bottom;
      previousMargin = parseFloat(style.marginBottom) || 0;
      visible++;
    }
    // Each fixture has at least 100 rows. Its first page extends below this
    // desktop viewport, including the mounted overscan in the virtualized tree.
    return below ? visible : 0;
  };
}
