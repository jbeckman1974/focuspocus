import { useEffect, useState, useSyncExternalStore } from "react";
import { HttpError, jsonRequest, readSession } from "../api.ts";
import { PreferenceResource } from "./resource.ts";
import type { Versioned } from "./resource.ts";
import { applyAccountChanges, mergeAccountChanges, initialAccount, initialDevice } from "./types.ts";
import type { AccountPatch, AccountSettings, DeviceSettings, PersonalSettings } from "./types.ts";

let fallbackDevice: string | undefined;
function browserDevice(): string {
  const key = "focuspocus.device.v1";
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(saved)) return saved;
    const device = crypto.randomUUID();
    localStorage.setItem(key, device);
    return device;
  } catch {
    return (fallbackDevice ??= crypto.randomUUID());
  }
}

function resources(id: string, actorId: number, csrf: string) {
  const abort = new AbortController();
  const base = "/api/v1/workspaces/" + encodeURIComponent(id) + "/preferences/";
  function endpoint<T, P>(path: string) {
    const url = base + path;
    const headers = { "X-FocusPocus-Actor": String(actorId) };
    const read = () => jsonRequest<Versioned<T>>(url, { signal: abort.signal, headers });
    const patch = async (expectedVersion: number, changes: P) => {
      const write = () => jsonRequest<Versioned<T>>(url, {
        method: "PATCH", signal: abort.signal, body: JSON.stringify({ expectedVersion, changes }),
        headers: { ...headers, "Content-Type": "application/json", "X-CSRFToken": csrf },
      });
      try { return await write(); }
      catch (error) {
        if (!(error instanceof HttpError) || error.status !== 403) throw error;
        const session = await readSession(abort.signal);
        if (session.user?.id !== actorId || !session.workspaces.some((space) => space.id === id)) throw error;
        csrf = session.csrfToken;
        return write();
      }
    };
    return { read, patch };
  }
  const account = new PreferenceResource<AccountSettings, AccountPatch>({
    ...endpoint<AccountSettings, AccountPatch>("account"), initial: initialAccount,
    apply: applyAccountChanges, merge: mergeAccountChanges,
  });
  const device = new PreferenceResource<DeviceSettings, Partial<DeviceSettings>>({
    ...endpoint<DeviceSettings, Partial<DeviceSettings>>("device/" + browserDevice()), initial: initialDevice,
    merge: (old, patch) => ({ ...old, ...patch }), apply: (old, patch) => ({ ...old, ...patch }),
  });
  return { account, device, abort };
}

const noop = () => {};
const emptySubscribe = () => noop;
const initialAccountState = { values: initialAccount, message: "Loading preferences…", failed: false };
const initialDeviceState = { values: initialDevice, message: "Loading preferences…", failed: false };
const emptyAccount = () => initialAccountState;
const emptyDevice = () => initialDeviceState;

export function usePersonalPreferences(id: string, actorId: number, csrf: string): PersonalSettings {
  const [current, setCurrent] = useState<{ id: string; actorId: number; csrf: string; stores: ReturnType<typeof resources> }>();
  const stores = current?.id === id && current.actorId === actorId && current.csrf === csrf ? current.stores : undefined;
  const account = useSyncExternalStore(stores?.account.subscribe ?? emptySubscribe, stores?.account.snapshot ?? emptyAccount);
  const device = useSyncExternalStore(stores?.device.subscribe ?? emptySubscribe, stores?.device.snapshot ?? emptyDevice);
  useEffect(() => {
    const active = resources(id, actorId, csrf);
    setCurrent({ id, actorId, csrf, stores: active });
    const refresh = () => { void active.account.refresh(); void active.device.refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      active.account.stop();
      active.device.stop();
      active.abort.abort();
    };
  }, [id, actorId, csrf]);
  if (!stores) return { account: initialAccount, device: initialDevice, setAccount: noop, setDevice: noop, message: "Loading preferences…" };
  const failed = [stores.account, stores.device].filter((store) => store.snapshot().failed);
  return {
    account: account.values, device: device.values,
    setAccount: stores.account.change, setDevice: stores.device.change,
    message: failed[0]?.snapshot().message ?? (account.message || device.message),
    retry: failed.length ? () => failed.forEach((store) => store.resolve(true)) : undefined,
    discard: failed.length ? () => failed.forEach((store) => store.resolve(false)) : undefined,
  };
}
