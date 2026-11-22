export interface BrowserSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  unsubscribe(): Promise<boolean>;
}

export async function enrollSubscription(
  manager: {
    getSubscription(): Promise<BrowserSubscription | null>;
    subscribe(options: {
      userVisibleOnly: true;
      applicationServerKey: Uint8Array<ArrayBuffer>;
    }): Promise<BrowserSubscription>;
  },
  key: Uint8Array<ArrayBuffer>,
  replace: boolean,
  checkAccount: () => Promise<void>,
  save: (endpoint: string) => Promise<void>,
) {
  await checkAccount();
  let current = await manager.getSubscription();
  if (current && replace) {
    await checkAccount();
    if (!(await current.unsubscribe()))
      throw new Error(
        "The browser could not release the previous subscription.",
      );
    current = null;
  }
  if (current) {
    const old = current.options.applicationServerKey;
    if (
      !old ||
      old.byteLength !== key.byteLength ||
      !new Uint8Array(old).every((byte, i) => byte === key[i])
    ) {
      throw new Error(
        "The notification key changed. Replace this browser subscription to use the current key.",
      );
    }
  } else {
    await checkAccount();
    current = await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  await checkAccount();
  await save(current.endpoint);
}
