import legacyWorker from "../persistent/tools/notification-worker.ts?worker&url";
import { activated, ensureAppWorker } from "./registration.ts";

export async function notificationManager(replace: boolean, checkAccount: () => Promise<void>) {
  if (import.meta.env.DEV) {
    const registration = await navigator.serviceWorker.register(legacyWorker, { type: "module" });
    return (await activated(registration)).pushManager;
  }
  const installation = await ensureAppWorker();
  const legacy = await navigator.serviceWorker.getRegistration("/assets/");
  const script = legacy?.active?.scriptURL;
  if (!script || !legacy || legacy.scope !== new URL("/assets/", location.origin).href)
    return installation.pushManager;
  const worker = new URL(script);
  if (worker.origin !== location.origin || !/^\/assets\/notification-worker-[\w-]{8,64}\.js$/.test(worker.pathname))
    return installation.pushManager;
  const previous = await legacy.pushManager.getSubscription();
  if (!previous) return installation.pushManager;
  if (!replace) {
    // An existing M5 device can check its enrollment without changing the endpoint.
    return (await installation.pushManager.getSubscription()) ? installation.pushManager : legacy.pushManager;
  }
  await checkAccount();
  if (!(await previous.unsubscribe()))
    throw new Error("The browser could not release the previous notification subscription.");
  return installation.pushManager;
}
