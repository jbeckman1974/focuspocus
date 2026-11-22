import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("provider sign-in submits the session's CSRF token after a failed login", async ({
  page,
}) => {
  const csrfToken = randomUUID();
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      json: { authMode: "oidc", user: null, workspaces: [], csrfToken },
    }),
  );
  await page.route("**/api/v1/oidc/start", (route) =>
    route.fulfill({ contentType: "text/plain", body: "Provider sign-in" }),
  );
  await page.goto("/app/?signin=failed");
  await expect(page.getByRole("alert")).toContainText("Provider sign-in failed");
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  const pending = page.waitForRequest("**/api/v1/oidc/start");
  await page
    .getByRole("button", { name: "Sign in with identity provider" })
    .click();
  const request = await pending;
  expect(request.method()).toBe("POST");
  expect(
    new URLSearchParams(request.postData() ?? "").get("csrfmiddlewaretoken"),
  ).toBe(csrfToken);
});
