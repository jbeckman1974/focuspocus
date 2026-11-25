import { expect, test } from "@playwright/test";
import { sidebarDestination, task } from "../e2e/controls.ts";
import { createDestination, signIn } from "./account.ts";
import { focusProject, openPlanning } from "./planning-controls.ts";
import { createShared, selectWorkspace } from "./workspace-tools.ts";

test("capturing in a project outside Focus explains where tasks went and preserves the original focus", async ({
  page,
}) => {
  await signIn(page, "owner");
  const workspace = await createShared(page, "Survey field notes");
  const focused = "Hillcrest trail";
  const project = "Marsh profiles";
  const first = "Establish a cross section";
  const next = ["Read the staff gauge", "Record the water level"];
  await createDestination(page, "project", focused);
  await focusProject(page, focused);
  const focus = page.getByLabel("Active focus");
  await expect(focus).toHaveText(focused);
  await openPlanning(page, "Projects");

  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  const name = dialog.getByRole("textbox", { name: "Project name" });
  await name.fill(project);
  const created = page.waitForResponse(/\/commands\/create-container$/);
  await name.press("Enter");
  const projectResponse = await created;
  expect(projectResponse.status()).toBe(200);
  const [projectId] = (await projectResponse.json()).selection;
  await expect(
    page.getByRole("heading", { name: project, exact: true }),
  ).toBeVisible();

  const include = page.getByRole("button", {
    name: "Include project in Focus",
    exact: true,
  });
  const notice = page
    .getByRole("status")
    .filter({ hasText: "This project is outside your Focus." });
  await expect(include).toBeVisible();
  await expect(notice).toContainText("Its tasks are hidden.");
  const field = page.getByRole("textbox", { name: "Task titles" });
  const add = page.getByRole("button", { name: "Add tasks", exact: true });
  const ids: string[] = [];
  for (const titles of [[first], next]) {
    await field.fill(titles.join("\n"));
    await expect(add).toBeEnabled();
    const saved = page.waitForResponse(/\/commands\/capture$/);
    if (titles.length === 1) await field.press("Enter");
    else await add.click();
    const response = await saved;
    expect(response.status()).toBe(200);
    const receipt = await response.json();
    expect(receipt.selection).toHaveLength(titles.length);
    ids.push(...receipt.selection);
    await expect(field).toHaveValue("");
    const quantity = `${titles.length} task${titles.length === 1 ? "" : "s"}`;
    await expect(notice).toContainText(`Added ${quantity} to ${project}.`);
    for (const title of titles) await expect(task(page, title)).toHaveCount(0);
    await expect(focus).toHaveText(focused);
  }

  const reread = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/v1/workspaces/${workspace}/snapshot` && response.ok(),
  );
  await page.reload();
  const picker = page.getByLabel("Active workspace");
  await expect(picker).toBeVisible();
  if ((await picker.inputValue()) !== workspace)
    await selectWorkspace(page, workspace);
  const snapshot = await (await reread).json();
  const stored: { id: string; title: string; parentId: string }[] =
    snapshot.tasks;
  for (const [index, title] of [first, ...next].entries()) {
    const matching = stored.filter((entry) => entry.title === title);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ id: ids[index], parentId: projectId });
  }

  await sidebarDestination(page, project).click();
  await expect(focus).toHaveText(focused);
  await include.click();
  await expect(focus).toContainText(focused);
  await expect(focus).toContainText(project);
  await expect(include).toHaveCount(0);
  for (const [index, title] of [first, ...next].entries()) {
    const row = task(page, title);
    await expect(row).toHaveAttribute("data-task-id", ids[index]);
    await expect(row.getByText(project, { exact: true })).toBeVisible();
  }
});

test("a project created from Forecast receives its first task after the acknowledged creation", async ({
  page,
}) => {
  await signIn(page, "owner");
  await createShared(page, "Instrument surveys");
  await openPlanning(page, "Forecast");
  const project = "Bridge clearance";
  const title = "Measure the soffit height";
  const create = /\/commands\/create-container$/;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: (status: number) => void;
  const serverStatus = new Promise<number>((resolve) => {
    committed = resolve;
  });
  let requests = 0;
  await page.route(create, async (route) => {
    requests++;
    const response = await route.fetch();
    committed(response.status());
    await gate;
    await route.fulfill({ response });
  });

  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  const name = dialog.getByRole("textbox", { name: "Project name" });
  const submit = dialog.getByRole("button", {
    name: "Create project",
    exact: true,
  });
  await name.fill(project);
  try {
    await submit.click();
    expect(await serverStatus).toBe(200);
    await expect(dialog).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(requests).toBe(1);
  } finally {
    release();
  }
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: project, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("toolbar", { name: "Workspace actions" })
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  const capture = page.getByRole("textbox", { name: "Task titles" });
  await expect(capture).toBeFocused();
  await capture.fill(title);
  await capture.press("Enter");
  const row = task(page, title);
  await expect(row.getByText(project, { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});
