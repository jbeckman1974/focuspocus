import { transaction } from "./storeDatabase.ts";
import { notifyOffline } from "./storeEvents.ts";
import { checkBinding, type Profile } from "./storeTypes.ts";

export type MembershipInfo = { id: string; role: string };
export function prune(
  profile: Profile,
  spaces: readonly MembershipInfo[],
  drop: (actor: number, workspace: string) => void,
) {
  let changed = false;
  const roles = new Map(spaces.map((space) => [space.id, space.role]));
  for (const [id, enrollment] of Object.entries(profile.enrollments ?? {})) {
    if (roles.get(id) !== enrollment.role || enrollment.until <= Date.now()) {
      delete profile.enrollments![id];
      changed = true;
    }
  }
  for (const [id, header] of Object.entries(profile.spaces)) {
    if (roles.get(id) === header.space.role) continue;
    drop(profile.actorId!, id);
    delete profile.spaces[id];
    if (profile.active === id) profile.active = null;
    changed = true;
  }
  return changed;
}

export async function pruneOfflineDirectory(
  actor: number,
  spaces: readonly MembershipInfo[],
  epoch: string,
) {
  if (!epoch) return;
  const changed = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, dropData }) => {
      checkBinding(profile, actor, epoch);
      if (!prune(profile, spaces, dropData)) return false;
      saveProfile();
      return true;
    },
  );
  if (changed) notifyOffline("workspace");
}

export async function markOfflineActive(
  actor: number,
  id: string,
  epoch: string,
) {
  if (!epoch) return;
  await transaction("readwrite", null, ({ profile, saveProfile }) => {
    checkBinding(profile, actor, epoch);
    const active = Object.hasOwn(profile.spaces, id) ? id : null;
    if (profile.active !== active) {
      profile.active = active;
      saveProfile();
    }
  });
}

export async function forgetOfflineWorkspace(
  actor: number,
  id: string,
  epoch: string,
) {
  if (!epoch) return;
  const removed = await transaction(
    "readwrite",
    null,
    ({ profile, saveProfile, dropData }) => {
      checkBinding(profile, actor, epoch);
      if (!Object.hasOwn(profile.spaces, id) && !profile.enrollments?.[id])
        return false;
      if (profile.enrollments) delete profile.enrollments[id];
      dropData(actor, id);
      delete profile.spaces[id];
      if (profile.active === id) profile.active = null;
      saveProfile();
      return true;
    },
  );
  if (removed) notifyOffline("workspace");
}
