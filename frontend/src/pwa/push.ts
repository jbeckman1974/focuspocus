import legacyWorker from "../persistent/tools/notification-worker.ts?worker&url";
import { selectPushManager } from "../persistent/tools/enrollment.ts";
import { activated, ensureAppWorker } from "./registration.ts";

export async function notificationManager(
  replace: boolean,
  checkAccount: () => Promise<void>,
) {
  if (import.meta.env.DEV) {
    const registration = await navigator.serviceWorker.register(legacyWorker, {
      type: "module",
    });
    return (await activated(registration)).pushManager;
  }
  const installation = await ensureAppWorker();
  const legacy = await navigator.serviceWorker.getRegistration("/assets/");
  const script = legacy?.active?.scriptURL;
  if (
    !script ||
    !legacy ||
    legacy.scope !== new URL("/assets/", location.origin).href
  )
    return installation.pushManager;
  const worker = new URL(script);
  if (
    worker.origin !== location.origin ||
    !/^\/assets\/notification-worker-[\w-]{8,64}\.js$/.test(worker.pathname)
  )
    return installation.pushManager;
  return selectPushManager(
    installation.pushManager,
    legacy.pushManager,
    replace,
    checkAccount,
  );
}
