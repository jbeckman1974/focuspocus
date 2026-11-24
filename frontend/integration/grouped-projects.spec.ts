import { expect, test, type Page } from "@playwright/test";
import { sidebarDestination, task, taskId } from "../e2e/controls.ts";
import { createDestination, signIn, submitCapture } from "./account.ts";
import { trustDevice } from "./offline-device.ts";
import { createShared, selectWorkspace } from "./workspace-tools.ts";

const plat = "Review field drawing";
const groupTitle = "Survey records";

function row(page: Page, id: string) {
  return page
    .getByRole("tree", { name: "Task outline" })
    .locator(`[data-task-id="${id}"]`);
}

async function makeGroup(page: Page, first: string, second: string) {
  await row(page, first).getByText(plat, { exact: true }).click();
  await row(page, second)
    .getByText("Check boundaries", { exact: true })
    .click({
      modifiers: ["Shift"],
    });
  await expect(row(page, first)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, second)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Group…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Group tasks" });
  await dialog.getByLabel("Group title").fill(groupTitle);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/commands/group"),
  );
  await dialog
    .getByRole("button", { name: "Group tasks", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const { selection } = await response.json();
  expect(selection).toHaveLength(1);
  const id: string = selection[0];
  await expect(
    row(page, id).getByText(groupTitle, { exact: true }),
  ).toBeVisible();
  return id;
}

async function organize(page: Page, operation: string) {
  await page.getByRole("button", { name: "Organize…", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Organize workspace" })
    .getByRole("button", { name: operation, exact: true })
    .click();
}

test("AT-01/27 · same-named groups keep both projects visible through edits and reload", async ({
  page,
}) => {
  await signIn(page, "owner");
  const workspace = await createShared(page, "Two subdivision surveys");
  const north = "North parcel";
  const south = "South parcel";
  const marker = "Locate survey marker";
  const revision = "Revised field drawing";

  await createDestination(page, "project", north);
  await sidebarDestination(page, north).click();
  await submitCapture(page, [plat, "Check boundaries", marker].join("\n"));
  const northPlat = await taskId(page, plat);
  const northCheck = await taskId(page, "Check boundaries");
  const markerId = await taskId(page, marker);
  const northGroup = await makeGroup(page, northPlat, northCheck);

  await createDestination(page, "project", south);
  await sidebarDestination(page, south).click();
  await submitCapture(page, [plat, "Check boundaries"].join("\n"));
  const southPlat = await taskId(page, plat);
  const southCheck = await taskId(page, "Check boundaries");
  const overview = page
    .getByRole("navigation", { name: "Perspectives", exact: true })
    .getByRole("button", { name: "Projects", exact: true });
  await overview.click();
  await expect(row(page, northGroup)).toBeVisible();
  await expect(row(page, southPlat)).toBeVisible();
  const southGroup = await makeGroup(page, southPlat, southCheck);
  expect(southGroup).not.toBe(northGroup);
  await expect(overview).toHaveAttribute("aria-current", "page");
  for (const id of [northGroup, southGroup]) {
    await expect(row(page, id)).toHaveAttribute("aria-expanded", "true");
  }
  for (const [id, project] of [
    [northPlat, north],
    [northCheck, north],
    [southPlat, south],
    [southCheck, south],
  ]) {
    await expect(row(page, id)).toHaveAttribute("aria-level", "2");
    await expect(
      row(page, id).getByText(project, { exact: true }),
    ).toBeVisible();
  }

  await row(page, southGroup)
    .getByRole("button", { name: `Collapse ${groupTitle}` })
    .click();
  await expect(row(page, southPlat)).toHaveCount(0);
  await expect(row(page, northPlat)).toBeVisible();
  await row(page, markerId).getByText(marker, { exact: true }).click();
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  const move = page.getByRole("dialog", { name: "Move tasks" });
  await move
    .getByRole("combobox", { name: "Move to" })
    .selectOption({ label: `${south} / ${groupTitle}` });
  await move.getByRole("button", { name: "Move tasks", exact: true }).click();
  await expect(row(page, markerId)).toHaveAttribute("aria-level", "2");
  await expect(
    row(page, markerId).getByText(south, { exact: true }),
  ).toBeVisible();
  await expect(row(page, southGroup)).toHaveAttribute("aria-expanded", "true");
  await expect(overview).toHaveAttribute("aria-current", "page");

  await row(page, southPlat).getByText(plat, { exact: true }).dblclick();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(revision);
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await row(page, southPlat).getByText(revision, { exact: true }).click();
  await organize(page, "Move to Trash");
  await expect(row(page, southPlat)).toHaveCount(0);
  await expect(
    row(page, northPlat).getByText(plat, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    row(page, southPlat).getByText(revision, { exact: true }),
  ).toBeVisible();
  await row(page, southGroup).getByText(groupTitle, { exact: true }).click();
  await organize(page, "Ungroup");
  await expect(row(page, southGroup)).toHaveCount(0);
  for (const id of [southPlat, southCheck, markerId]) {
    await expect(row(page, id)).toHaveAttribute("aria-level", "1");
  }
  await expect(row(page, northGroup)).toHaveAttribute("aria-expanded", "true");

  await page.reload();
  const picker = page.getByLabel("Active workspace");
  await expect(picker).toBeVisible();
  if ((await picker.inputValue()) !== workspace)
    await selectWorkspace(page, workspace);
  await overview.click();
  await expect(row(page, northPlat)).toHaveAttribute("aria-level", "2");
  await expect(row(page, northCheck)).toHaveAttribute("aria-level", "2");
  await expect(row(page, southGroup)).toHaveCount(0);
  await expect(
    row(page, southPlat).getByText(revision, { exact: true }),
  ).toBeVisible();
  await expect(row(page, southCheck)).toHaveAttribute("aria-level", "1");
  await expect(
    row(page, markerId).getByText(south, { exact: true }),
  ).toBeVisible();

  await sidebarDestination(page, north).click();
  await page
    .getByRole("toolbar", { name: "Workspace actions" })
    .getByRole("button", { name: "Add task", exact: true })
    .click();
  await submitCapture(page, "Check north boundaries again");
  await expect(sidebarDestination(page, north)).toHaveAttribute(
    "aria-current",
    "page",
  );
  const added = await taskId(page, "Check north boundaries again");
  await expect(
    row(page, added).getByText(north, { exact: true }),
  ).toBeVisible();
});

test("AT-27 · same-named sibling groups can be targeted and ungrouped independently", async ({
  page,
}) => {
  await signIn(page, "owner");
  await createShared(page, "Two filing groups");
  const project = "Plat submissions";
  const marker = "Request a signature";
  await createDestination(page, "project", project);
  await sidebarDestination(page, project).click();
  const check = "Check boundaries";
  await submitCapture(page, [plat, check, plat, check, marker].join("\n"));
  const idsForTitle = async (title: string) => {
    const matches = task(page, title);
    await expect(matches).toHaveCount(2);
    return matches.evaluateAll((rows) =>
      rows.map((element) => element.getAttribute("data-task-id")!),
    );
  };
  const [firstPlat, secondPlat] = await idsForTitle(plat);
  const [firstCheck, secondCheck] = await idsForTitle(check);
  const markerId = await taskId(page, marker);
  const firstGroup = await makeGroup(page, firstPlat, firstCheck);
  const secondGroup = await makeGroup(page, secondPlat, secondCheck);
  const rows = page
    .getByRole("tree", { name: "Task outline" })
    .getByRole("treeitem");
  const currentOrder = () =>
    rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-task-id")),
    );
  const grouped = [
    firstGroup,
    firstPlat,
    firstCheck,
    secondGroup,
    secondPlat,
    secondCheck,
    markerId,
  ];
  await expect.poll(currentOrder).toEqual(grouped);

  await row(page, markerId).getByText(marker, { exact: true }).click();
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move tasks" });
  const destination = dialog.getByRole("combobox", { name: "Move to" });
  const label = (id: string) =>
    destination.locator(`option[value="${id}"]`).innerText();
  const firstLabel = await label(firstGroup);
  const secondLabel = await label(secondGroup);
  expect(firstLabel).toContain(groupTitle);
  expect(secondLabel).toContain(groupTitle);
  expect(firstLabel).not.toEqual(secondLabel);
  await destination.selectOption({ label: firstLabel });
  await dialog.getByRole("button", { name: "Move tasks", exact: true }).click();
  await expect
    .poll(currentOrder)
    .toEqual([
      firstGroup,
      firstPlat,
      firstCheck,
      markerId,
      secondGroup,
      secondPlat,
      secondCheck,
    ]);
  await expect(row(page, markerId)).toHaveAttribute("aria-level", "2");

  await trustDevice(page);
  await sidebarDestination(page, project).click();
  await row(page, secondGroup).getByText(groupTitle, { exact: true }).click();
  await organize(page, "Ungroup");
  await expect
    .poll(currentOrder)
    .toEqual([
      firstGroup,
      firstPlat,
      firstCheck,
      markerId,
      secondPlat,
      secondCheck,
    ]);
  await expect(row(page, firstGroup)).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, secondPlat)).toHaveAttribute("aria-level", "1");
  await expect(row(page, secondPlat)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, secondCheck)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, firstPlat)).toHaveAttribute("aria-selected", "false");
  await expect(row(page, markerId)).toHaveAttribute("aria-level", "2");
});
