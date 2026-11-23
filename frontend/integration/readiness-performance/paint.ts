import type { Page } from "@playwright/test";
import type { FixtureRow, ViewportWindow } from "./viewport.ts";

export type Target =
  | { kind: "outline"; name: string; count: number; rows: FixtureRow[] }
  | { kind: "search"; text: string; count: number; rows: FixtureRow[] }
  | { kind: "selection" | "title"; text: string }
  | { kind: "editing"; value: string };

export type ProbeWindow = Window & {
  benchmarkPaint?: Promise<number>;
  benchmarkPaintAt?: number;
};

// Record the trusted browser event timestamp, including any waiting in the event queue.
// Two successive animation frames bracket a paint of the verified state. Playwright
// polling and transport time do not contribute to the observation.
type Trigger =
  "pointerdown" | "keydown" | "beforeinput" | "last-search-key" | "online";

export async function armPaint(
  page: Page,
  event: Trigger | null,
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
          const list = tree.querySelector<HTMLElement>(".outline-window");
          return (
            list &&
            (window as ViewportWindow).benchmarkViewport!(
              "outline",
              tree,
              list,
              target.rows,
            )
          );
        }
        if (target.kind === "search") {
          const results = document.querySelector(
            '[aria-label="Search results"]',
          );
          const field = document.querySelector<HTMLInputElement>(
            'input[type="search"]',
          );
          if (
            field?.value !== target.text ||
            results?.querySelector('[role="status"]')?.textContent !==
              target.count + " matches"
          )
            return false;
          const clip = results?.closest<HTMLElement>(".planning-page");
          const list = results?.querySelector<HTMLElement>(".planning-results");
          return (
            clip &&
            list &&
            (window as ViewportWindow).benchmarkViewport!(
              "search",
              clip,
              list,
              target.rows,
            )
          );
        }
        return false;
      };
      (window as ProbeWindow).benchmarkPaint = new Promise<number>(
        (resolve) => {
          const start = (from: number) => {
            let seen: ReturnType<typeof check> = false;
            const frame = () => {
              const ready = check();
              if (ready && ready === seen) {
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
            const browserEvent =
              event === "last-search-key" ? "keydown" : event;
            const listen = (input: Event) => {
              if (!input.isTrusted) return;
              if (event === "last-search-key") {
                const field = input.target;
                if (
                  target.kind !== "search" ||
                  !(input instanceof KeyboardEvent) ||
                  !(field instanceof HTMLInputElement) ||
                  field.type !== "search" ||
                  field !== document.activeElement ||
                  field.value !== target.text.slice(0, -1) ||
                  input.key !== target.text.at(-1)
                )
                  return;
              }
              window.removeEventListener(browserEvent, listen, true);
              clearTimeout(timeout);
              start(input.timeStamp);
            };
            const timeout = window.setTimeout(() => {
              window.removeEventListener(browserEvent, listen, true);
              resolve(-1);
            }, 60_000);
            window.addEventListener(browserEvent, listen, true);
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
  event: Trigger,
  target: Target,
  dispatch: () => Promise<unknown>,
) {
  await armPaint(page, event, target);
  await dispatch();
  return painted(page);
}
