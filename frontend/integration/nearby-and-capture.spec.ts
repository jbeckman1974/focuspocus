import { expect, test } from "@playwright/test";
import { createDestination, signIn, submitCapture } from "./account.ts";
import { createShared, toolsPanel, closeTools } from "./workspace-tools.ts";
import { inspector, task } from "../e2e/controls.ts";

test("AT-26/32 · find a tagged task by a saved place and revoke a scoped capture credential", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await signIn(page, "owner");
  await createShared(page, "Nearby crew board");
  const title = "Recover canal monument",
    tag = "Canal crossing";
  await createDestination(page, "tag", tag);
  await page
    .getByRole("navigation", { name: "Perspectives", exact: true })
    .getByRole("button", { name: "Inbox", exact: true })
    .click();
  await submitCapture(page, title);
  await task(page, title).getByText(title, { exact: true }).click();
  const check = inspector(page).getByRole("checkbox", {
    name: tag,
    exact: true,
  });
  await check.check();
  await expect(check).toBeChecked();
  let panel = await toolsPanel(page, "Nearby");
  await panel.getByLabel("Location tag").selectOption({ label: tag });
  await panel.getByLabel("Latitude", { exact: true }).fill("28.10");
  await panel.getByLabel("Longitude", { exact: true }).fill("-82.20");
  await panel.getByLabel("Radius in meters").fill("200");
  await panel.getByRole("button", { name: "Save tag location" }).click();
  await panel
    .getByLabel("Or choose a saved place")
    .selectOption({ label: tag });
  await panel.getByRole("button", { name: title, exact: true }).click();
  await expect(task(page, title)).toBeVisible();
  panel = await toolsPanel(page, "Sharing");
  await panel.getByLabel("Credential name").fill("Quick field capture");
  await panel
    .getByRole("button", { name: "Create capture credential" })
    .click();
  const token = await panel
    .getByLabel("New capture credential", { exact: true })
    .inputValue();
  const headers = { Authorization: "Bearer " + token };
  const context = await request.post("/api/v1/capture/context", {
    data: {},
    headers,
  });
  expect(context.status()).toBe(200);
  const envelope = {
    context: (await context.json()).context,
    operationId: crypto.randomUUID(),
    title: "Captured on site",
  };
  const capture = await request.post("/api/v1/capture", {
    data: envelope,
    headers,
  });
  expect(capture.status()).toBe(200);
  const ack = await capture.json();
  const retry = await request.post("/api/v1/capture", {
    data: envelope,
    headers,
  });
  expect((await retry.json()).itemId).toBe(ack.itemId);
  await panel
    .getByRole("button", { name: "Revoke Quick field capture", exact: true })
    .click();
  await expect(
    panel.getByRole("button", {
      name: "Revoke Quick field capture",
      exact: true,
    }),
  ).not.toBeVisible();
  expect(
    (
      await request.post("/api/v1/capture/context", { data: {}, headers })
    ).status(),
  ).toBe(401);
  await closeTools(page);
});
