import { expect, test, type Page } from "@playwright/test";
import { inspector } from "../e2e/controls.ts";
import { signIn, withProfile } from "./account.ts";

async function settings(page: Page) {
  await page
    .getByRole("navigation", { name: "Perspectives", exact: true })
    .getByRole("button", { name: "Preferences", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Workspace preferences" });
}

test("AT-28 · appearance follows the account while the inspector layout stays on its device", async ({
  page,
  browser,
}) => {
  await signIn(page, "planner");
  const panel = await settings(page);
  const density = panel.getByRole("combobox", { name: /^Row density/ });
  await expect(density).toHaveValue("comfortable");
  const choice = "compact";
  const acknowledged = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/preferences\/account\/?$/.test(response.url()),
  );
  await density.selectOption(choice);
  expect((await acknowledged).status()).toBe(200);
  await panel
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  const closed = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/preferences/device/"),
  );
  await inspector(page)
    .getByRole("button", { name: "Close inspector" })
    .click();
  expect((await closed).status()).toBe(200);
  await expect(inspector(page)).toBeHidden();

  await withProfile(browser, "planner", async (otherDevice) => {
    await expect(inspector(otherDevice)).toBeVisible();
    const elsewhere = await settings(otherDevice);
    await expect(
      elsewhere.getByRole("combobox", { name: /^Row density/ }),
    ).toHaveValue(choice);
  });
  await withProfile(browser, "neighbor", async (otherUser) => {
    const unrelated = await settings(otherUser);
    await expect(
      unrelated.getByRole("combobox", { name: /^Row density/ }),
    ).toHaveValue("comfortable");
  });
  await page.reload();
  const reopened = await settings(page);
  await expect(
    reopened.getByRole("combobox", { name: /^Row density/ }),
  ).toHaveValue(choice);
  await reopened
    .getByRole("button", { name: "Close preferences", exact: true })
    .click();
  await expect(inspector(page)).toBeHidden();
});
