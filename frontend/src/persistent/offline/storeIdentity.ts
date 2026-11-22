import type { Session } from "../api.ts";
import { transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import { checkBinding, freshProfile, makeLease, requireReadable, type OfflineBoot, type Profile } from "./storeTypes.ts";

const barrierName = "focuspocus.pending-logout.v1";
export function shadowLogout() {
  try {
    const raw = localStorage.getItem(barrierName);
    const actor = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(actor) && actor > 0 ? actor : null;
  } catch { return null; }
}

function storeShadow(actor: number) {
  try { localStorage.setItem(barrierName, String(actor)); return true; }
  catch { return false; }
}

export async function pendingLogout() {
  const shadow = shadowLogout();
  return transaction("readonly", null, ({ profile }) => profile.logoutActor ?? shadow).catch(() => shadow);
}

export async function finishLogout(actor: number) {
  await transaction("readwrite", null, ({profile, saveProfile}) => {
    if (profile.logoutActor === actor) { profile.logoutActor = null; saveProfile(); }
  }).catch((error) => { if (shadowLogout() !== actor) throw error; });
  if (shadowLogout() === actor) localStorage.removeItem(barrierName);
}

export type MembershipInfo = { id: string; role: string };
function prune(profile: Profile, spaces: readonly MembershipInfo[], drop: (actor: number, workspace: string) => void) {
  let changed = false;
  const roles = new Map(spaces.map((space) => [space.id, space.role]));
  for (const [id, header] of Object.entries(profile.spaces)) {
    if (roles.get(id) === header.space.role) continue;
    drop(profile.actorId!, id);
    delete profile.spaces[id];
    if (profile.active === id) profile.active = null;
    changed = true;
  }
  return changed;
}

export async function pruneOfflineDirectory(actor: number, spaces: readonly MembershipInfo[], epoch: string) {
  if (!epoch) return;
  const changed = await transaction("readwrite", null, ({profile, saveProfile, dropData}) => {
    checkBinding(profile, actor, epoch);
    if (!prune(profile, spaces, dropData)) return false;
    saveProfile();
    return true;
  });
  if (changed) notifyOffline("workspace");
}

export async function markOfflineActive(actor: number, id: string, epoch: string) {
  if (!epoch) return;
  await transaction("readwrite", null, ({profile, saveProfile}) => {
    checkBinding(profile, actor, epoch);
    const active = Object.hasOwn(profile.spaces, id) ? id : null;
    if (profile.active !== active) { profile.active = active; saveProfile(); }
  });
}

function boot(profile: Profile): OfflineBoot | null {
  if (!profile.authenticated || !profile.actorId || !profile.active || profile.logoutActor !== null) return null;
  const header = profile.spaces[profile.active];
  if (!header) return null;
  requireReadable(header);
  return {actor: {id: profile.actorId, username: profile.username}, space: header.space,
    lease: makeLease(profile, header), expiresAt: header.expiresAt};
}

export async function offlineBoot() {
  if (shadowLogout() !== null) return null;
  return transaction("readonly", null, ({profile}) => boot(profile));
}

// Obtain this fence before an online request so a delayed response from an old
// account cannot switch the browser back or unlock a completed sign-out.
export async function currentEpoch() {
  return transaction("readonly", null, ({profile}) => profile.epoch);
}

export async function observeSession(session: Session, expected: string) {
  const state = await transaction("readwrite", null, ({profile, saveProfile, clearData, dropData}) => {
    if (profile.epoch !== expected || profile.logoutActor !== null || shadowLogout() !== null)
      throw new Error("The active device session changed.");
    const actor = session.user?.id ?? null;
    let identityChanged = false;
    if (actor !== null && actor !== profile.actorId) {
      clearData();
      Object.assign(profile, freshProfile(), {actorId: actor, authenticated: true});
      identityChanged = true;
    } else if (profile.authenticated !== (actor !== null)) {
      profile.authenticated = actor !== null;
      profile.epoch = crypto.randomUUID();
      identityChanged = true;
    }
    const removed = actor !== null && prune(profile, session.workspaces, dropData);
    if (identityChanged || removed) saveProfile();
    const retained = profile.active ? profile.spaces[profile.active]?.space ?? null : null;
    return {epoch: profile.epoch, initialSpace: actor !== null ? retained : null, identityChanged, removed};
  });
  if (state.identityChanged) notifyOffline("identity");
  else if (state.removed) notifyOffline("workspace");
  return state;
}

export async function beginLogout(actor: number, epoch: string, discard: boolean): Promise<"pending"|"cleared"> {
  if (!epoch) {
    if (!storeShadow(actor)) throw new Error("Unable to save the sign-out request. Connect before signing out.");
    notifyOffline("identity");
    return "cleared";
  }
  const cleared = await transaction("readwrite", null, ({profile, saveProfile, clearData}) => {
    checkBinding(profile, actor, epoch);
    if (!discard && Object.values(profile.spaces).some(h => h.pending > 0)) return false;
    clearData();
    Object.assign(profile, freshProfile(), {logoutActor: actor});
    saveProfile();
    return true;
  });
  if (!cleared) return "pending";
  storeShadow(actor);
  notifyOffline("identity");
  return "cleared";
}

export function pendingSpaces(actor: number, epoch: string) {
  if (!epoch) return Promise.resolve([]);
  return transaction("readonly", null, ({profile}) => {
    checkBinding(profile, actor, epoch);
    return Object.values(profile.spaces).filter(header => header.pending > 0)
      .map(header => ({name: header.space.name, count: header.pending}));
  });
}

export async function forgetOfflineWorkspace(actor:number,id:string,epoch:string) {
  if (!epoch) return;
  const removed = await transaction("readwrite",null,({profile,saveProfile,dropData})=>{
    checkBinding(profile,actor,epoch);
    if (!Object.hasOwn(profile.spaces,id)) return false;
    dropData(actor,id);
    delete profile.spaces[id];
    if (profile.active===id) profile.active=null;
    saveProfile();
    return true;
  });
  if(removed)notifyOffline("workspace");
}
