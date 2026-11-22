const path = "/app/sw.js";

export async function activated(registration: ServiceWorkerRegistration) {
  if (registration.active?.state === "activated") return registration;
  const worker =
    registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) throw new Error("The application shell is unavailable.");
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      worker.removeEventListener("statechange", change);
      if (error) reject(error);
      else resolve();
    };
    const change = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant")
        finish(
          new Error("Offline installation failed. Reconnect and try again."),
        );
    };
    const timer = window.setTimeout(
      () =>
        finish(
          new Error(
            "Offline installation did not finish. Reconnect and retry.",
          ),
        ),
      30000,
    );
    worker.addEventListener("statechange", change);
    change();
  });
  return registration;
}

export async function ensureAppWorker() {
  if (!window.isSecureContext || !("serviceWorker" in navigator))
    throw new Error(
      "Use HTTPS or localhost in a browser that supports offline installation.",
    );
  if (!import.meta.env.PROD)
    throw new Error(
      "Offline installation needs the built application at /app/.",
    );
  const registration = await navigator.serviceWorker.register(path, {
    scope: "/app/",
    type: "module",
    updateViaCache: "none",
  });
  await activated(registration);
  const active = registration.active;
  if (!active)
    throw new Error("The installed application shell is unavailable.");
  const channel = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    const finish = (ready: boolean) => {
      window.clearTimeout(timer);
      channel.port1.close();
      if (ready) resolve();
      else
        reject(
          new Error(
            "The offline app files are unavailable. Reconnect and retry.",
          ),
        );
    };
    const timer = window.setTimeout(() => finish(false), 30000);
    channel.port1.onmessage = (event) => finish(event.data === true);
    try {
      active.postMessage("focuspocus-verify-public-shell", [channel.port2]);
    } catch {
      channel.port2.close();
      finish(false);
    }
  });
  return registration;
}
