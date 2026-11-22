import { freshProfile, type OfflineData, type Profile } from "./storeTypes.ts";

const databaseName = "focuspocus-trusted-device";
const profileTable = "profile";
const workspaceTable = "workspaces";
let connection: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) { request.transaction?.abort(); return; }
      const db = request.result;
      db.createObjectStore(profileTable).add(freshProfile(), "device");
      db.createObjectStore(workspaceTable);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
    request.onblocked = () => { blocked = true; reject(new Error("Close other FocusPocus tabs to update offline storage.")); };
    request.onerror = () => reject(request.error ?? new Error("Offline storage could not open."));
  }).catch((error) => { connection = undefined; throw error; });
  return connection;
}

export const dataKey = (actor: number, workspace: string): IDBValidKey => [actor, workspace];

interface Access<T> {
  profile: Profile;
  data: OfflineData<T> | undefined;
  saveProfile(): void;
  saveData(actor: number, workspace: string, value: OfflineData<T>): void;
  dropData(actor: number, workspace: string): void;
  clearData(): void;
}

// All reads and writes for a mutation share one native transaction. Its callback
// is synchronous so no network or unrelated await can let IndexedDB autocommit.
export async function transaction<T, R>(
  mode: IDBTransactionMode,
  key: IDBValidKey | null,
  edit: (access: Access<T>) => R,
): Promise<R> {
  const db = await openDatabase();
  return new Promise<R>((resolve, reject) => {
    const tx = db.transaction([profileTable, workspaceTable], mode);
    const profiles = tx.objectStore(profileTable), records = tx.objectStore(workspaceTable);
    const profileRequest = profiles.get("device");
    const dataRequest = key === null ? undefined : records.get(key);
    let value: R;
    let failure: unknown;
    let waiting = dataRequest ? 2 : 1;
    const loaded = () => {
      if (--waiting > 0) return;
      try {
        const profile = profileRequest.result as Profile | undefined;
        if (!profile) throw new Error("Offline profile could not be read.");
        value = edit({
          profile, data: dataRequest?.result,
          saveProfile: () => { profiles.put(profile, "device"); },
          saveData: (actor, workspace, data) => { records.put(data, dataKey(actor, workspace)); },
          dropData: (actor, workspace) => { records.delete(dataKey(actor, workspace)); },
          clearData: () => { records.clear(); },
        });
        if (value instanceof Promise) throw new Error("Offline transactions require a synchronous update.");
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    profileRequest.onsuccess = loaded;
    if (dataRequest) dataRequest.onsuccess = loaded;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("Offline storage transaction was interrupted."));
  });
}
