import { expect, test, type Page } from "@playwright/test";
import { signIn, withProfile } from "./account.ts";

async function settings(page: Page) {
  await page.getByRole("navigation", { name: "Perspectives", exact: true })
    .getByRole("button", { name: "Preferences", exact: true }).click();
  return page.getByRole("dialog", { name: "Workspace preferences" });
}

test("AT-28 · personal appearance reaches a new browser while another account keeps its own setting", async ({
  page, browser,
}) => {
  await signIn(page, "planner");
  const panel = await settings(page);
  const density = panel.getByRole("combobox", { name: /^Row density/ });
  const previous = await density.inputValue();
  const choice = previous === "compact" ? "comfortable" : "compact";
  const acknowledged = page.waitForResponse((response) =>
    response.request().method() === "PATCH" &&
    /\/preferences\/account\/?$/.test(response.url()),
  );
  await density.selectOption(choice);
  expect((await acknowledged).status()).toBe(200);
  await panel.getByRole("button", { name: "Close preferences", exact: true }).click();

  await withProfile(browser, "planner", async (otherDevice) => {
    const elsewhere = await settings(otherDevice);
    await expect(elsewhere.getByRole("combobox", { name: /^Row density/ })).toHaveValue(choice);
  });
  await withProfile(browser, "neighbor", async (otherUser) => {
    const unrelated = await settings(otherUser);
    await expect(unrelated.getByRole("combobox", { name: /^Row density/ })).toHaveValue("comfortable");
  });
  await page.reload();
  const reopened = await settings(page);
  await expect(reopened.getByRole("combobox", { name: /^Row density/ })).toHaveValue(choice);
});
