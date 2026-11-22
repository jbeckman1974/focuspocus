import { useState } from "react";
import { enrollSubscription } from "./enrollment.ts";
import { WorkspaceFailure } from "./transport.ts";
import { notificationManager } from "../../pwa/push.ts";
import { browserDevice } from "../preferences/device.ts";
import { useAction, useResource } from "./hooks.ts";
import type { WorkspaceClient } from "./transport.ts";

export function DeviceNotifications({
  client,
  publicKey,
}: {
  client: WorkspaceClient;
  publicKey: string | null;
}) {
  const path = "integrations/devices/" + browserDevice();
  const device = useResource<{ enabled: boolean }>(client, path),
    action = useAction();
  const supported =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  const enabled = device.data?.enabled === true;
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  async function enroll(replace: boolean) {
    if (!publicKey || !supported) return;
    const consent = await Notification.requestPermission();
    if (consent !== "granted")
      throw new Error(
        "Browser notifications are unavailable. Reminders remain in your list.",
      );
    const key = Uint8Array.from(
      atob(publicKey.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    const checkAccount = async () => {
      await client.json(path);
      client.signal.throwIfAborted();
    };
    const manager = await notificationManager(replace, checkAccount);
    client.signal.throwIfAborted();
    await enrollSubscription(
      manager,
      key,
      replace,
      checkAccount,
      async (endpoint) => {
        try {
          device.setData(
            await client.post<{ enabled: boolean }>(path, { endpoint }),
          );
        } catch (e) {
          if (e instanceof WorkspaceFailure && e.status === 409)
            throw new Error(
              "This subscription is already registered. Replace it to receive notifications for the current account.",
            );
          throw e;
        }
      },
    );
    setConfirmReplacement(false);
  }
  return (
    <fieldset>
      <legend>Notifications on this browser</legend>
      {enabled && (
        <button
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              device.setData(
                await client.post<{ enabled: boolean }>(path, {
                  endpoint: null,
                }),
              );
            })
          }
        >
          Disable this account’s notifications on this browser
        </button>
      )}
      {supported && publicKey ? (
        <>
          <button
            disabled={action.busy || !device.data}
            onClick={() => void action.run(() => enroll(false))}
          >
            {enabled
              ? "Check current browser subscription"
              : "Enable browser notifications"}
          </button>
          {!confirmReplacement ? (
            <button
              disabled={action.busy || !device.data}
              onClick={() => setConfirmReplacement(true)}
            >
              Replace browser subscription…
            </button>
          ) : (
            <div>
              <p>
                Replacing the subscription stops deliveries using this browser's
                old endpoint, including deliveries for a previously signed-in
                account.
              </p>
              <button
                disabled={action.busy}
                onClick={() => void action.run(() => enroll(true))}
              >
                Replace and enroll this account
              </button>
              <button
                disabled={action.busy}
                onClick={() => setConfirmReplacement(false)}
              >
                Keep current subscription
              </button>
            </div>
          )}
        </>
      ) : (
        <p>
          {!supported
            ? "This browser cannot receive push notifications."
            : "The operator has not configured push delivery."}{" "}
          Reminders are available here.
        </p>
      )}
      {(device.error || action.error) && (
        <p role="alert">{device.error || action.error}</p>
      )}
    </fieldset>
  );
}
