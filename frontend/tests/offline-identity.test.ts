import assert from "node:assert/strict";
import test from "node:test";
import {
  checkBinding,
  checkLease,
  freshProfile,
  makeLease,
  OfflineAccessError,
  requireReadable,
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
