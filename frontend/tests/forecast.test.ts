import test from "node:test";
import assert from "node:assert/strict";
import {
  forecastDefaults,
  forecastPath,
} from "../src/persistent/planning/forecast.ts";

test("Forecast requests planned and due work with independent options", () => {
  const query = new URLSearchParams(
    forecastPath(
      { ...forecastDefaults, start: "2026-11-22", tagId: "tag", flagged: true },
      "America/New_York",
    ).split("?")[1],
  );
  assert.equal(query.get("start"), "2026-11-22");
  assert.equal(query.get("planned"), "1");
  assert.equal(query.get("deferred"), "0");
  assert.equal(query.get("tagId"), "tag");
  assert.equal(query.get("viewZone"), "America/New_York");
  assert.equal(
    new URLSearchParams(forecastPath(forecastDefaults, "").split("?")[1]).has(
      "start",
    ),
    false,
  );
});
