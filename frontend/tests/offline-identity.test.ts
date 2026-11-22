import assert from "node:assert/strict";
import test from "node:test";
import {
  clearReauth,
  markReauth,
  reauthFence,
} from "../src/persistent/offline/storeLock.ts";
import {
  checkBinding,
  checkLease,
  freshProfile,
  makeLease,
  OfflineAccessError,
  requireReadable,
  sameMembership,
  type Header,
} from "../src/persistent/offline/storeTypes.ts";

const header: Header = {
  space: { id: "space", name: "Shared work", role: "editor", private: false },
  grantId: "current-grant",
  generation: "current-generation",
  protocol: 1,
  expiresAt: 1_000,
  pending: 0,
};

function fixture() {
  const profile = {
    ...freshProfile(),
    actorId: 17,
    authenticated: true,
    spaces: { space: { ...header } },
  };
  return { profile, lease: makeLease(profile, header) };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof OfflineAccessError && error.code === expected;

test("a stale tab cannot update an account partition after sign-out and reauthentication", () => {
  const { profile, lease } = fixture();
  assert.equal(checkLease(profile, lease).grantId, header.grantId);
  assert.throws(
    () => checkLease({ ...profile, epoch: crypto.randomUUID() }, lease),
    code("locked"),
  );
  assert.throws(
    () => checkLease({ ...profile, logoutActor: 17 }, lease),
    code("locked"),
  );
  assert.throws(
    () => checkLease({ ...profile, authenticated: false }, lease),
    code("locked"),
  );
  assert.throws(() => checkBinding(profile, 19, profile.epoch), code("locked"));
});

test("revocation, rejoin and recovery each fence a prior partition", () => {
  const { profile, lease } = fixture();
  assert.throws(
    () => checkLease({ ...profile, spaces: {} }, lease),
    code("revoked"),
  );
  assert.throws(
    () => checkLease(profile, { ...lease, grantId: "previous" }),
    code("revoked"),
  );
  assert.throws(
    () => checkLease(profile, { ...lease, generation: "previous" }),
    code("generation"),
  );
  assert.throws(
    () => checkLease(profile, { ...lease, workspaceId: "constructor" }),
    code("revoked"),
  );
});

test("an expired, incompatible or recovery-fenced grant cannot open offline data", () => {
  assert.doesNotThrow(() => requireReadable(header, 999));
  assert.throws(() => requireReadable(header, 1000), code("expired"));
  assert.throws(
    () => requireReadable({ ...header, expiresAt: NaN }, 0),
    code("expired"),
  );
  assert.throws(
    () => requireReadable({ ...header, protocol: 2 }, 0),
    code("protocol"),
  );
  assert.throws(
    () => requireReadable({ ...header, fence: "generation" }, 0),
    code("generation"),
  );
});

test("a restored generation preserves a grant only for the same membership incarnation", () => {
  const cached = { ...header, membershipId: "grant-incarnation" };
  const from = (
    generation: string,
    membershipId: string | undefined,
    id: string,
    workspaceId = "space",
  ) => ({
    generation,
    workspaceId,
    offlineGrant: {
      id,
      membershipId,
      protocol: 1,
      expiresAt: new Date(1000).toISOString(),
    },
  });
  assert.equal(
    sameMembership(
      cached,
      from("restored", "grant-incarnation", "different-grant"),
    ),
    true,
  );
  assert.equal(
    sameMembership(
      cached,
      from("restored", "rejoined-membership", "different-grant"),
    ),
    false,
  );
  assert.equal(
    sameMembership(cached, from("restored", undefined, "different-grant")),
    false,
  );
  assert.equal(
    sameMembership(
      header,
      from("restored", "grant-incarnation", "different-grant"),
    ),
    false,
  );
  assert.equal(
    sameMembership(
      cached,
      from(header.generation, "grant-incarnation", "rotated-without-recovery"),
    ),
    false,
  );
  assert.equal(
    sameMembership(
      cached,
      from(
        "restored",
        "grant-incarnation",
        "different-grant",
        "other-workspace",
      ),
    ),
    false,
  );
});

test("an epoch-bound reauthentication fence denies cached reads even before the database could lock", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, v: string) => values.set(key, v),
      removeItem: (key: string) => values.delete(key),
    },
  });
  try {
    const { profile, lease } = fixture();
    const first = markReauth(profile.epoch);
    assert.ok(first);
    assert.throws(() => checkLease(profile, lease), code("locked"));
    const newer = markReauth(profile.epoch);
    clearReauth(profile.epoch, first);
    assert.equal(reauthFence(profile.epoch), newer);
    assert.throws(() => checkLease(profile, lease), code("locked"));
    clearReauth(profile.epoch, newer);
    assert.doesNotThrow(() => checkLease(profile, lease));
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
