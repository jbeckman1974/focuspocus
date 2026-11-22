import "../persistent/tools/notification-worker.ts";
import { publicRequests, shellPath } from "./cachePolicy.ts";

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
  addEventListener(
    type: "install" | "activate",
    listener: (event: WorkEvent) => void,
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: RequestEvent) => void,
  ): void;
  addEventListener(
    type: "message",
    listener: (event: WorkEvent & MessageEvent) => void,
  ): void;
}
const worker = globalThis as unknown as ShellWorker;
const prefix = "focuspocus-public-shell-";
const cacheName = prefix + __FP_SHELL__.version;

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      // addAll is atomic. A redirect, missing file or mismatched build digest
      // rejects installation, leaving the previous active release available.
      await cache.addAll(
        publicRequests(worker.location.origin, __FP_SHELL__.resources),
      );
    })(),
  );
});
worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix) && key !== cacheName)
          await caches.delete(key);
      }
      await worker.clients.claim();
    })(),
  );
});
worker.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = shellPath(
    request,
    worker.location.origin,
    __FP_SHELL__.resources,
  );
  if (!url) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(url)) ?? fetch(request);
    })(),
  );
});

// Recheck the active worker's release before a device promises offline access.
// Browsers can evict Cache Storage independently of a worker registration.
worker.addEventListener("message", (event) => {
  const reply = event.ports[0];
  if (event.data !== "focuspocus-verify-public-shell" || !reply) return;
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName);
        const present = new Set(
          (await cache.keys()).map((request) => new URL(request.url).pathname),
        );
        if (
          Object.keys(__FP_SHELL__.resources).some((path) => !present.has(path))
        ) {
          await cache.addAll(
            publicRequests(worker.location.origin, __FP_SHELL__.resources),
          );
        }
        reply.postMessage(true);
      } catch {
        reply.postMessage(false);
      }
    })(),
  );
});
