import { expect, test, type Page } from "@playwright/test";
import { inspector, task } from "../e2e/controls.ts";
import { signIn, submitCapture, withProfile } from "./account.ts";
import { queued, trustDevice, withDevice } from "./offline-device.ts";

async function authority(page: Page) {
  const id = await page.getByLabel("Active workspace").inputValue();
  return page.evaluate(async (workspace) => {
    const session = await (await fetch("/api/v1/session")).json();
    const response = await fetch(
      "/api/v1/workspaces/" + workspace + "/snapshot",
      {
        headers: { "X-FocusPocus-Actor": String(session.user.id) },
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw new Error("Unable to inspect the signed-in workspace.");
    const snapshot = await response.json();
    return {
      workspace,
      generation: snapshot.generation as string,
      grant: snapshot.offlineGrant.id as string,
      membership: snapshot.offlineGrant.membershipId as string,
    };
  }, id);
}

async function files(page: Page, title: string) {
  await task(page, title).getByText(title, { exact: true }).click();
  await inspector(page)
    .getByRole("button", { name: "Notes and files…" })
    .click();
  return page.getByRole("dialog", { name: "Notes and files" });
}

test("AT-20/22 · preserve a trusted draft and its file across a real fenced SQL restore", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const title = "Recovered field observation";
  const file = "survey-note.txt";
  const bytes = Buffer.from(
    "Private synthetic test data after a database recovery.\n",
  );
  await withDevice(async (device) => {
    const original = await device.launch();
    await signIn(original, "owner");
    const before = await authority(original);
    expect(before.membership).toMatch(/^[0-9a-f-]{36}$/);
    const anchor = await original
      .getByRole("treeitem", { name: /^Deployment check / })
      .first()
      .getAttribute("aria-label");
    if (!anchor)
      throw new Error(
        "Could not locate the captured task included in the SQL dump.",
      );
    await trustDevice(original);
    await device.connect(false);
    await submitCapture(original, title);
    await queued(original);
    const originalFiles = await files(original, anchor);
    await originalFiles
      .getByLabel("Attach file", { exact: true })
      .setInputFiles({ name: file, mimeType: "text/plain", buffer: bytes });
    await originalFiles
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(originalFiles).toContainText(
      "File saved on this device for sync.",
    );

    const recovered = await device.restart(true);
    await recovered.goto("/app/");
    await expect(task(recovered, title)).toBeVisible();
    device.network.openRestoredDatabase();
    await device.connect(true);
    await expect(
      recovered.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(recovered.getByText(title)).toHaveCount(0);
    await signIn(recovered, "owner");
    const after = await authority(recovered);
    expect(after.workspace).toBe(before.workspace);
    expect(after.membership).toBe(before.membership);
    expect(after.grant).not.toBe(before.grant);
    expect(after.generation).not.toBe(before.generation);
    const held = recovered.getByRole("region", { name: "Offline changes" });
    const capture = held.getByRole("listitem").filter({ hasText: title });
    const upload = held.getByRole("listitem").filter({ hasText: file });
    await expect(
      capture.getByRole("button", { name: "Reapply change" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      upload.getByRole("button", { name: "Reapply change" }),
    ).toBeVisible();

    const inspectServer = () =>
      recovered.evaluate(
        async ({ id, title, file, anchor }) => {
          const { user } = await (await fetch("/api/v1/session")).json();
          const headers = { "X-FocusPocus-Actor": String(user.id) };
          const base = "/api/v1/workspaces/" + id;
          const data = await (
            await fetch(base + "/snapshot", { headers, cache: "no-store" })
          ).json();
          const tasks = data.tasks as { id: string; title: string }[];
          const anchorId = tasks.find((t) => t.title === anchor)?.id;
          const content = await (
            await fetch(base + "/content/items/" + anchorId, {
              headers,
              cache: "no-store",
            })
          ).json();
          return {
            captures: tasks.filter((t) => t.title === title).length,
            files: (content.files as { name: string }[]).filter(
              (f) => f.name === file,
            ).length,
          };
        },
        { id: after.workspace, title, file, anchor },
      );
    expect(await inspectServer()).toEqual({ captures: 0, files: 0 });
    await capture.getByRole("button", { name: "Reapply change" }).click();
    await expect
      .poll(inspectServer, { timeout: 20000 })
      .toEqual({ captures: 1, files: 0 });
    await upload.getByRole("button", { name: "Reapply change" }).click();
    await expect
      .poll(inspectServer, { timeout: 20000 })
      .toEqual({ captures: 1, files: 1 });
    await expect(held.getByRole("listitem")).toHaveCount(0);
    const recoveredFiles = await files(recovered, anchor);
    const href = await recoveredFiles
      .getByRole("link", { name: "Download " + file, exact: true })
      .getAttribute("href");
    if (!href)
      throw new Error(
        "Restored attachment did not expose its authorized download.",
      );
    const actual = await recovered.request.get(href);
    expect(actual.status()).toBe(200);
    expect((await actual.body()).equals(bytes)).toBe(true);

    await withProfile(browser, "owner", async (untouched) => {
      expect(await authority(untouched)).toEqual(before);
      await expect(task(untouched, title)).toHaveCount(0);
      const liveFiles = await files(untouched, anchor);
      await expect(
        liveFiles.getByRole("link", { name: "Download " + file, exact: true }),
      ).toHaveCount(0);
    });
  });
});
