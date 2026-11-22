import type { Snapshot } from "../api.ts";
import type { WorkspaceInfo } from "../tools/WorkspaceRouter.tsx";
import { transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import {
  checkBinding,
  freshData,
  headerFor,
  makeLease,
  OfflineAccessError,
  requireReadable,
} from "./storeTypes.ts";

export async function reserveEnrollment(
  actor: number,
  space: WorkspaceInfo,
  epoch: string,
) {
  return transaction("readwrite", null, ({ profile, saveProfile }) => {
    checkBinding(profile, actor, epoch);
    const token = crypto.randomUUID();
    profile.enrollments ??= {};
    profile.enrollments[space.id] = {
      token,
      role: space.role,
      until: Date.now() + 120_000,
    };
    saveProfile();
    return token;
  });
}
export async function cancelEnrollment(
  actor: number,
  space: string,
  epoch: string,
  token: string,
) {
  await transaction("readwrite", null, ({ profile, saveProfile }) => {
    if (
      profile.actorId === actor &&
      profile.epoch === epoch &&
      profile.enrollments?.[space]?.token === token
    ) {
      delete profile.enrollments[space];
      saveProfile();
    }
  });
}
export async function enableOffline(
  actor: { id: number; username: string },
  space: WorkspaceInfo,
  snapshot: Snapshot,
  epoch: string,
  token: string,
) {
  const header = headerFor(snapshot, space);
  const out = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, saveData }) => {
      checkBinding(profile, actor.id, epoch);
      const reservation = profile.enrollments?.[space.id];
      if (
        !reservation ||
        reservation.token !== token ||
        reservation.role !== space.role ||
        reservation.until <= Date.now()
      )
        throw new OfflineAccessError("revoked");
      delete profile.enrollments![space.id];
      const existing = profile.spaces[space.id];
      if (existing) {
        if (
          existing.grantId !== header.grantId ||
          existing.space.role !== space.role
        )
          throw new OfflineAccessError("revoked");
        if (existing.generation !== header.generation)
          throw new OfflineAccessError("generation");
        requireReadable(existing);
        saveProfile();
        return makeLease(profile, existing);
      }
      profile.spaces[space.id] = header;
      profile.username = actor.username;
      profile.active = space.id;
      saveData(actor.id, space.id, freshData(snapshot));
      saveProfile();
      return makeLease(profile, header);
    },
  );
  notifyOffline("workspace");
  return out;
}
