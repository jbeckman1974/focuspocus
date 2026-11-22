import "../persistent/tools/notification-worker.ts";

declare const __FP_SHELL__: {
  version: string;
  resources: Record<string, string>;
};
interface WorkEvent {
  waitUntil(work: Promise<unknown>): void;
}
interface RequestEvent extends WorkEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ShellWorker {
  location: Location;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: WorkEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: RequestEvent) => void): void;
}
const worker = globalThis as unknown as ShellWorker;
const prefix = "focuspocus-public-shell-";
const cacheName = prefix + __FP_SHELL__.version;

worker.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    // addAll is atomic. A redirect, missing file or mismatched build digest
    // rejects installation, leaving the previous active release available.
    const files = Object.entries(__FP_SHELL__.resources).map(([path, integrity]) =>
      new Request(new URL(path, worker.location.origin), {
        mode: "same-origin", credentials: "omit", redirect: "error", cache: "no-store", integrity,
      }),
    );
    await cache.addAll(files);
  })());
});
worker.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    }
    await worker.clients.claim();
  })());
});
worker.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== worker.location.origin ||
      url.search || !Object.hasOwn(__FP_SHELL__.resources, url.pathname) ||
      request.headers.has("authorization") || request.headers.has("range") ||
      (url.pathname === "/app/" && request.mode !== "navigate")) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(url.href)) ?? fetch(request);
  })());
});
