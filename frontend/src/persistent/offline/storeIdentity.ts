import { prune } from "./storeDirectory.ts";
import type { Session } from "../api.ts";
import {
  reauthFence,
  markReauth,
  clearReauth,
  pendingPurge,
  markPurge,
  clearPurge,
} from "./storeLock.ts";
import { transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import {
  checkBinding,
  freshProfile,
  makeLease,
  requireReadable,
  type OfflineBoot,
  type Profile,
} from "./storeTypes.ts";

const barrierName = "focuspocus.pending-logout.v1";
export function shadowLogout() {
  try {
    const raw = localStorage.getItem(barrierName);
    const actor = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(actor) && actor > 0 ? actor : null;
  } catch {
    return null;
  }
}

function storeShadow(actor: number) {
  try {
    localStorage.setItem(barrierName, String(actor));
    return true;
  } catch {
    return false;
  }
}

export async function pendingLogout() {
  const shadow = shadowLogout();
  return transaction(
    "readonly",
    null,
    ({ profile }) => profile.logoutActor ?? shadow,
  ).catch(() => shadow);
}

export async function finishLogout(actor: number) {
  await transaction("readwrite", null, ({ profile, saveProfile }) => {
    if (profile.logoutActor === actor) {
      profile.logoutActor = null;
      saveProfile();
    }
  }).catch((error) => {
    if (shadowLogout() !== actor) throw error;
  });
  if (shadowLogout() === actor) localStorage.removeItem(barrierName);
}

function boot(profile: Profile): OfflineBoot | null {
  if (
    !profile.authenticated ||
    !profile.actorId ||
    !profile.active ||
    profile.logoutActor !== null ||
    pendingPurge(profile.actorId) !== null ||
    reauthFence(profile.epoch) !== null
  )
    return null;
  const header = profile.spaces[profile.active];
  if (!header) return null;
  requireReadable(header);
  return {
    actor: { id: profile.actorId, username: profile.username },
    space: header.space,
    lease: makeLease(profile, header),
    expiresAt: header.expiresAt,
  };
}

export async function offlineBoot() {
  if (shadowLogout() !== null) return null;
  return transaction("readonly", null, ({ profile }) => boot(profile));
}

// Obtain this fence before an online request so a delayed response from an old
// account cannot switch the browser back or unlock a completed sign-out.
export async function currentBinding() {
  const result = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, clearData }) => {
      const actor = profile.actorId;
      const intent = actor ? pendingPurge(actor) : null;
      if (actor && intent) {
        clearData();
        Object.assign(profile, freshProfile());
        saveProfile();
      }
      return {
        epoch: profile.epoch,
        actor,
        intent,
        actorId: profile.actorId,
        authenticated: profile.authenticated,
      };
    },
  );
  if (result.actor && result.intent) clearPurge(result.actor, result.intent);
  return {
    epoch: result.epoch,
    actorId: result.actorId,
    authenticated: result.authenticated,
  };
}

export async function observeSession(
  session: Session,
  expected: string,
  observedFence: string | null,
) {
  const state = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, clearData, dropData }) => {
      if (
        profile.epoch !== expected ||
        reauthFence(expected) !== observedFence ||
        profile.logoutActor !== null ||
        shadowLogout() !== null
      )
        throw new Error("The active device session changed.");
      const actor = session.user?.id ?? null;
      const discardIntent = actor !== null ? pendingPurge(actor) : null;
      if (discardIntent && actor === profile.actorId)
        throw new Error(
          "Retry to finish clearing this browser’s earlier workspace.",
        );
      let identityChanged = false;
      if (actor !== null && actor !== profile.actorId) {
        clearData();
        Object.assign(profile, freshProfile(), {
          actorId: actor,
          authenticated: true,
        });
        identityChanged = true;
      } else if (
        profile.authenticated !== (actor !== null) ||
        observedFence !== null
      ) {
        profile.authenticated = actor !== null;
        profile.epoch = crypto.randomUUID();
        identityChanged = true;
      }
      const removed =
        actor !== null && prune(profile, session.workspaces, dropData);
      if (identityChanged || removed) saveProfile();
      const retained = profile.active
        ? (profile.spaces[profile.active]?.space ?? null)
        : null;
      return {
        epoch: profile.epoch,
        initialSpace: actor !== null ? retained : null,
        identityChanged,
        discardIntent,
        removed,
      };
    },
  );
  if (state.discardIntent && session.user)
    clearPurge(session.user.id, state.discardIntent);
  clearReauth(expected, observedFence);
  if (state.identityChanged) notifyOffline("identity");
  else if (state.removed) notifyOffline("workspace");
  return state;
}

export async function beginLogout(
  actor: number,
  epoch: string,
  discard: boolean,
): Promise<"pending" | "cleared"> {
  if (!epoch) {
    if (!markPurge(actor) || !storeShadow(actor))
      throw new Error(
        "Unable to save the sign-out request. Connect before signing out.",
      );
    notifyOffline("identity");
    return "cleared";
  }
  const cleared = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, clearData }) => {
      checkBinding(profile, actor, epoch);
      if (!discard && Object.values(profile.spaces).some((h) => h.pending > 0))
        return false;
      clearData();
      Object.assign(profile, freshProfile(), { logoutActor: actor });
      saveProfile();
      return true;
    },
  );
  if (!cleared) return "pending";
  storeShadow(actor);
  notifyOffline("identity");
  return "cleared";
}

export function pendingSpaces(actor: number, epoch: string) {
  if (!epoch) return Promise.resolve([]);
  return transaction("readonly", null, ({ profile }) => {
    checkBinding(profile, actor, epoch);
    return Object.values(profile.spaces)
      .filter((header) => header.pending > 0)
      .map((header) => ({ name: header.space.name, count: header.pending }));
  });
}

// A server 401 is already authoritative. Keep any queued work under its owner,
// but reject all offline reads and stale tab writes before another network hop.
export async function lockOfflineActor(actor: number, epoch: string) {
  if (!epoch) return;
  const fence = markReauth(epoch);
  let changed = false;
  try {
    changed = await transaction(
      "readwrite",
      null,
      ({ profile, saveProfile }) => {
        if (
          profile.actorId !== actor ||
          profile.epoch !== epoch ||
          !profile.authenticated
        )
          return false;
        profile.authenticated = false;
        profile.epoch = crypto.randomUUID();
        delete profile.enrollments;
        saveProfile();
        return true;
      },
    );
    clearReauth(epoch, fence);
  } catch (error) {
    notifyOffline("identity");
    if (!fence) throw error;
    return; // Online confirmation must now consume the fallback fence.
  }
  if (changed) notifyOffline("identity");
}
