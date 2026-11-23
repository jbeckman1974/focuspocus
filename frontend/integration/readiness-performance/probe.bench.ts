import { expect, test } from "@playwright/test";
import { armPaint, painted, type ProbeWindow } from "./paint.ts";
import { installViewportCheck, type ViewportWindow } from "./viewport.ts";

const rows = Array.from({ length: 12 }, (_, i) => ({
  id: "fixture-" + i,
  title: "Row " + i,
}));

test("the paint probe requires every visible identity in order and a filled first viewport", async ({
  page,
}) => {
  await page.setContent(`<style>
    .clip { height: 105px; overflow: auto; }
    ul { padding: 0; margin: 0; } li { list-style: none; margin-block: 2px; }
    button, [role=treeitem] { display: block; width: 100%; height: 30px; box-sizing: border-box; }
    @media (prefers-color-scheme: dark) { button, [role=treeitem] { height: 35px; } }
  </style><div class="clip" id="tree"><div class="outline-window">${rows.map((row) => `<div role="treeitem" data-task-id="${row.id}" aria-label="${row.title}"><span class="outline-title">${row.title}</span></div>`).join("")}</div></div>
    <div class="clip" id="results"><ul>${rows.map((row) => `<li><button data-item-id="${row.id}">${row.title}</button></li>`).join("")}</ul></div>`);
  await page.evaluate(installViewportCheck);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const observations = await page.evaluate((expected) => {
      const check = (window as ViewportWindow).benchmarkViewport!;
      const clip = document.querySelector<HTMLElement>("#results")!;
      const list = clip.firstElementChild as HTMLElement;
      const search = () => check("search", clip, list, expected);
      const correctSearch = search();
      const late = list.querySelectorAll("button")[2];
      const originalId = late.dataset.itemId;
      late.dataset.itemId = "wrong-id";
      const staleId = search();
      late.dataset.itemId = originalId;
      const titles = [...list.querySelectorAll("button")];
      list.children[2].before(list.children[3]);
      const swapped = search();
      list.children[2].before(list.children[3]);
      const tail = [...list.children].slice(2);
      tail.forEach((node) => node.remove());
      const truncated = search();
      list.append(...tail);
      titles[2].style.transform = "translateY(9px)";
      const gap = search();
      titles[2].style.transform = "";
      const tree = document.querySelector<HTMLElement>("#tree")!;
      const items = tree.firstElementChild as HTMLElement;
      const outline = () => check("outline", tree, items, expected);
      const correctOutline = outline();
      const label = items.querySelectorAll(".outline-title")[2];
      label.textContent = "Stale display";
      const staleTitle = outline();
      label.textContent = expected[2].title;
      return {
        correctSearch,
        correctOutline,
        staleId,
        staleTitle,
        swapped,
        truncated,
        gap,
      };
    }, rows);
    const visible = scheme === "light" ? 4 : 3;
    expect(observations).toEqual({
      correctSearch: visible,
      correctOutline: visible,
      staleId: 0,
      staleTitle: 0,
      swapped: 0,
      truncated: 0,
      gap: 0,
    });
  }
});

test("a typed search starts on its final trusted key and waits for the settled result count", async ({
  page,
}) => {
  await page.setContent(`<style>.planning-page{overflow:auto;height:140px} ul{margin:0;padding:0} li{list-style:none} button{display:block;height:30px}</style>
    <input type="search"><main class="planning-page"><section aria-label="Search results"><p role="status">13 matches</p><ul class="planning-results">${rows.map((row) => `<li><button data-item-id="${row.id}">${row.title}</button></li>`).join("")}</ul></section></main>`);
  await page.evaluate(installViewportCheck);
  await page.evaluate(() => {
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.isTrusted && event.key === "h")
          performance.mark("last-fixture-key", { startTime: event.timeStamp });
      },
      true,
    );
  });
  await armPaint(page, "last-search-key", {
    kind: "search",
    text: "bench",
    count: 12,
    rows,
  });
  await page.locator("input").pressSequentially("bench", { delay: 35 });
  const waiting = await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return (window as ProbeWindow).benchmarkPaintAt === undefined;
  });
  expect(waiting).toBe(true);
  await page.getByRole("status").evaluate((el) => {
    el.textContent = "12 matches";
  });
  const duration = await painted(page);
  const startError = await page.evaluate(
    (ms) =>
      Math.abs(
        (window as ProbeWindow).benchmarkPaintAt! -
          performance.timeOrigin -
          ms -
          performance.getEntriesByName("last-fixture-key")[0].startTime,
      ),
    duration,
  );
  expect(startError).toBeLessThan(1);
});
