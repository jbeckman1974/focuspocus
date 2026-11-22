import {
  actorRequest,
  HttpError,
  jsonPost,
  readSession,
  type Session,
} from "../api.ts";
import { reauthFence } from "./storeLock.ts";
import type { WorkspaceInfo } from "../tools/WorkspaceRouter.tsx";
import {
  currentEpoch,
  finishLogout,
  observeSession,
  offlineBoot,
  pendingLogout,
} from "./store.ts";

export interface AccountState {
  session: Session;
  epoch: string;
  initialSpace: WorkspaceInfo | null;
  offlineBootstrap: boolean;
  expiresAt?: number;
}

export async function openAccount(
  signal: AbortSignal,
  allowOffline: boolean,
): Promise<AccountState> {
  const barrier = await pendingLogout();
  const epoch = await currentEpoch().catch(() => "");
  const observedFence=epoch ? reauthFence(epoch) : null;
  let session: Session;
  try {
    session = await readSession(signal);
  } catch (cause) {
    if (signal.aborted) throw cause;
    if (barrier !== null)
      throw new Error(
        "Signed out on this device. Connect to finish signing out.",
      );
    if (!allowOffline || cause instanceof HttpError) throw cause;
    const cached = await offlineBoot();
    if (!cached)
      throw new Error(
        "Connect to open your workspace. Offline editing requires a trusted device.",
      );
    return {
      session: {
        user: cached.actor,
        workspaces: [{ id: cached.space.id, role: cached.space.role }],
        csrfToken: "",
      },
      epoch: cached.lease.epoch,
      initialSpace: cached.space,
      offlineBootstrap: true,
      expiresAt: cached.expiresAt,
    };
  }
  signal.throwIfAborted();
  if (barrier !== null) {
    if (session.user?.id === barrier)
      session = await actorRequest<Session>(barrier, "/api/v1/logout", {
        ...jsonPost(session.csrfToken, {}),
        signal,
      });
    signal.throwIfAborted();
    await finishLogout(barrier);
  }
  const observed = epoch
    ? await observeSession(session, epoch, observedFence)
    : { epoch: "", initialSpace: null };
  return {
    session,
    epoch: observed.epoch,
    initialSpace: observed.initialSpace,
    offlineBootstrap: false,
  };
}
