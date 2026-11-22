export type OfflineEvent = "identity" | "workspace" | "data";
type Observer = (event: OfflineEvent, remote: boolean) => void;
const listeners = new Set<Observer>();
const channelName = "focuspocus-device-events-v1";
let channel: BroadcastChannel | undefined;

function deliver(kind: unknown, remote: boolean) {
  if (kind === "identity" || kind === "workspace" || kind === "data")
    for (const listener of listeners) {
      try {
        listener(kind, remote);
      } catch {
        /* A view closing during delivery cannot invalidate a committed edit. */
      }
    }
}

function storageMessage(event: StorageEvent) {
  if (event.key === channelName && event.newValue)
    deliver(event.newValue.split("/")[0], true);
}

function start() {
  if (typeof BroadcastChannel !== "undefined" && !channel) {
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event) => deliver(event.data, true);
    } catch {
      /* Private profiles may disable messaging. */
    }
  }
}

export function offlineEvents(observer: Observer) {
  if (!listeners.size) {
    start();
    window.addEventListener("storage", storageMessage);
  }
  listeners.add(observer);
  return () => {
    listeners.delete(observer);
    if (!listeners.size) {
      channel?.close();
      channel = undefined;
      window.removeEventListener("storage", storageMessage);
    }
  };
}

export function notifyOffline(kind: OfflineEvent) {
  deliver(kind, false);
  start();
  if (channel) {
    try {
      channel.postMessage(kind);
      return;
    } catch {
      /* Use the content-free storage signal if messaging is suspended. */
    }
  }
  try {
    localStorage.setItem(channelName, kind + "/" + crypto.randomUUID());
  } catch {
    /* Database transactions still enforce identity after missed events. */
  }
}
