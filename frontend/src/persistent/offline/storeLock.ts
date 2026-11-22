// This content-free fence protects an existing trusted partition when a 401
// arrives but the browser cannot persist the ordinary IndexedDB lock.
const prefix = "focuspocus.reauthenticate.";
export function reauthFence(epoch:string) {
  try { return localStorage.getItem(prefix+epoch); }
  catch { return null; }
}
export function markReauth(epoch:string) {
  const nonce=crypto.randomUUID();
  try { localStorage.setItem(prefix+epoch,nonce); return nonce; }
  catch { return null; }
}
export function clearReauth(epoch:string,nonce:string|null) {
  if (!nonce || reauthFence(epoch)!==nonce) return;
  try {localStorage.removeItem(prefix+epoch);}
  catch { /* The completed database transaction already rotated the epoch. */ }
}
