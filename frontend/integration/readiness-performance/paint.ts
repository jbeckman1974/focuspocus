import type { Page } from "@playwright/test";

export type Target =
  | { kind: "outline"; name: string; count: number; actions: string[] }
  | { kind: "search"; text: string; count: number; actions: string[] }
  | { kind: "selection" | "title"; text: string }
  | { kind: "editing"; value: string };

export type ProbeWindow = Window & {
  benchmarkPaint?: Promise<number>;
  benchmarkPaintAt?: number;
};

// Record the trusted browser event timestamp, including any waiting in the event queue.
// Two successive animation frames bracket a paint of the verified state. Playwright
// polling and transport time do not contribute to the observation.
export async function armPaint(
  page: Page,
  event: string | null,
  target: Target,
) {
  await page.evaluate(
    ({ event, target }) => {
      const visible = (el: Element | null, clip?: Element | null) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect(),
          bounds = clip?.getBoundingClientRect();
        return (
          rect.height > 0 &&
          rect.width > 0 &&
          rect.bottom > Math.max(0, bounds?.top ?? 0) &&
          rect.top < Math.min(innerHeight, bounds?.bottom ?? innerHeight) &&
          rect.right > 0 &&
          rect.left < innerWidth
        );
      };
      const check = () => {
        const tree = document.querySelector<HTMLElement>(
          '[role="tree"][aria-label="Task outline"]',
        );
        if (target.kind === "editing") {
          const input = document.activeElement;
          return (
            input instanceof HTMLInputElement &&
            input.getAttribute("aria-label") === "Task title" &&
            input.value === target.value &&
            visible(input, tree)
          );
        }
        if (target.kind === "selection" || target.kind === "title") {
          const row =
            tree?.querySelector(
              '[aria-label="' + CSS.escape(target.text) + '"]',
            ) ?? null;
          return (
            visible(row, tree) &&
            (target.kind === "title" ||
              (row?.getAttribute("aria-selected") === "true" &&
                row.id === tree?.getAttribute("aria-activedescendant") &&
                document.activeElement === tree))
          );
        }
        if (target.kind === "outline") {
          const heading = document.querySelector(".outline-heading h1");
          const count = document.querySelector(".outline-count");
          if (
            !tree ||
            !visible(tree) ||
            heading?.textContent !== target.name ||
            count?.textContent !== target.count + " items"
          )
            return false;
          if (!target.actions.length)
            return tree.querySelector('[role="treeitem"]') === null;
          const rendered = tree.querySelectorAll(
            '[role="treeitem"][aria-label^="Action "]',
          );
          return target.actions.every(
            (title, i) =>
              rendered[i]?.getAttribute("aria-label") === title &&
              visible(rendered[i], tree),
          );
        }
        if (target.kind === "search") {
          const results = document.querySelector(
            '[aria-label="Search results"]',
          );
          const field = document.querySelector<HTMLInputElement>(
            'input[type="search"]',
          );
          const rows = results?.querySelectorAll("button[data-item-id]");
          return (
            field?.value === target.text &&
            results?.querySelector('[role="status"]')?.textContent ===
              target.count + " matches" &&
            target.actions.every(
              (title, i) =>
                rows?.[i]?.textContent === title && visible(rows[i]),
            )
          );
        }
        return false;
      };
      (window as ProbeWindow).benchmarkPaint = new Promise<number>(
        (resolve) => {
          const start = (from: number) => {
            let seen = false;
            const frame = () => {
              const ready = check();
              if (ready && seen) {
                const at = performance.now();
                (window as ProbeWindow).benchmarkPaintAt =
                  performance.timeOrigin + at;
                return resolve(at - from);
              }
              seen = ready;
              // A timeout is reported as missing/correctness failure, never as a slow sample.
              if (performance.now() - from > 60_000) return resolve(-1);
              requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          };
          if (event) {
            const listen = (input: Event) => {
              if (!input.isTrusted) return;
              window.removeEventListener(event, listen, true);
              clearTimeout(timeout);
              start(input.timeStamp);
            };
            const timeout = window.setTimeout(() => {
              window.removeEventListener(event, listen, true);
              resolve(-1);
            }, 60_000);
            window.addEventListener(event, listen, true);
          } else start(performance.now());
        },
      );
    },
    { event, target },
  );
}

export async function painted(page: Page): Promise<number> {
  const result = await page.evaluate(
    () => (window as ProbeWindow).benchmarkPaint,
  );
  if (typeof result !== "number" || result < 0)
    throw new Error("Expected focused, settled first viewport did not paint.");
  return result;
}

export async function interaction(
  page: Page,
  event: string,
  target: Target,
  dispatch: () => Promise<unknown>,
) {
  await armPaint(page, event, target);
  await dispatch();
  return painted(page);
}
