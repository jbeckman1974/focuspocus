let fallbackDevice: string | undefined;
export function browserDevice(): string {
  const key = "focuspocus.device.v1";
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(saved))
      return saved;
    const device = crypto.randomUUID();
    localStorage.setItem(key, device);
    return device;
  } catch {
    return (fallbackDevice ??= crypto.randomUUID());
  }
}
