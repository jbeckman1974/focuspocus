import assert from "node:assert/strict";
import test from "node:test";
import { publicRequests, shellPath } from "../src/pwa/cachePolicy.ts";

const origin = "https://example.test";
const resources = {
  "/app/": "sha256-app",
  "/assets/main-a.js": "sha256-script",
};

test("only exact unauthenticated public routes and canonical navigation match the shell", () => {
  const request = {
    url: origin + "/app/",
    method: "GET",
    mode: "navigate" as RequestMode,
    headers: new Headers(),
  };
  assert.equal(shellPath(request, origin, resources), request.url);
  assert.equal(
    shellPath({ ...request, mode: "cors" }, origin, resources),
    null,
  );
  for (const method of ["HEAD", "POST", "PUT", "DELETE"]) {
    assert.equal(shellPath({ ...request, method }, origin, resources), null);
  }
  for (const [header, value] of [
    ["Authorization", "test"],
    ["Range", "bytes=0-4"],
    ["X-FocusPocus-Actor", "2"],
  ]) {
    assert.equal(
      shellPath(
        { ...request, headers: new Headers({ [header]: value }) },
        origin,
        resources,
      ),
      null,
    );
  }
  for (const path of [
    "/app/?query",
    "/api/v1/session",
    "/api/v1/workspaces/fixture/files",
    "/app/export.zip",
    "/assets/mod.js",
  ]) {
    assert.equal(
      shellPath({ ...request, url: origin + path }, origin, resources),
      null,
    );
  }
  assert.equal(
    shellPath(
      { ...request, url: "https://elsewhere.test/assets/main-a.js" },
      origin,
      resources,
    ),
    null,
  );
  assert.equal(
    shellPath(
      { ...request, mode: "cors", url: origin + "/assets/main-a.js" },
      origin,
      resources,
    ),
    origin + "/assets/main-a.js",
  );
});

test("precache requests omit credentials, require build integrity, and reject redirects", () => {
  for (const request of publicRequests(origin, resources)) {
    assert.equal(request.credentials, "omit");
    assert.equal(request.cache, "no-store");
    assert.equal(request.mode, "same-origin");
    assert.equal(request.redirect, "error");
    assert.equal(
      request.integrity,
      resources[new URL(request.url).pathname as keyof typeof resources],
    );
  }
});
