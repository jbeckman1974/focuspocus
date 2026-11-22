import { expect, test } from "@playwright/test";
import { signIn } from "./account.ts";
import { createShared } from "./workspace-tools.ts";

test("a confirmed directory response removes the source draft when both memberships disappear during a switch", async ({
  page,
}) => {
  await signIn(page, "planner");
  const requested = await createShared(page, "Departed team");
  const previous = await createShared(page, "Withdrawn project");
  const picker = page.getByLabel("Active workspace");
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await capture.fill("Draft for the withdrawn project");

  // Resolve both the periodic refresh and the explicit request only after
  // selection. The sharing journey covers a second account revoking access.
  const switching = page.getByText("Switching workspace…", { exact: true });
  let fallback = "";
  const directory = /\/api\/v1\/sharing\/workspaces$/;
  await page.route(directory, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (!fallback) await switching.waitFor();
    const response = await route.fetch();
    const { workspaces } = (await response.json()) as {
      workspaces: { id: string; private: boolean }[];
    };
    fallback = workspaces.find((space) => space.private)!.id;
    await route.fulfill({
      response,
      json: {
        workspaces: workspaces.filter(
          (space) => space.id !== previous && space.id !== requested,
        ),
      },
    });
  });
  const reopened = page.waitForResponse(
    (r) =>
      !!fallback &&
      new URL(r.url()).pathname.endsWith(
        "/workspaces/" + fallback + "/snapshot",
      ) &&
      r.ok(),
  );
  await picker.selectOption(requested);
  await reopened;
  await expect(
    page.getByRole("button", { name: "Retry workspace switch" }),
  ).toBeVisible();
  await expect(capture).toHaveValue("");
  await expect(picker.locator(`option[value="${previous}"]`)).toHaveCount(0);
  await expect(picker.locator(`option[value="${requested}"]`)).toHaveCount(0);
});
