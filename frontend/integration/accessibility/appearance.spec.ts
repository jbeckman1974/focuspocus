import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { task, taskId } from "../../e2e/controls.ts";

async function textContrast(control: Locator) {
  return control.evaluate((element) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (alpha !== 255)
        throw new Error("Contrast probe needs an opaque surface");
      function linear(channel: number) {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      }
      return (
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
      );
    }
    const { color, backgroundColor } = getComputedStyle(element);
    const foreground = luminance(color);
    const background = luminance(backgroundColor);
    return (
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
    );
  });
}

test("AT-24/28 · a pointer user can read the selected sample row in both themes and large type", async ({
  page,
}) => {
  await page.goto("/sample/");
  const add = page.getByRole("button", { name: "Add task", exact: true });
  await add.click();
  const label = "Read this field note";
  await page.getByRole("textbox", { name: "Task titles" }).fill(label);
  await page.getByRole("button", { name: "Add tasks" }).click();
  const id = await taskId(page, label);
  const row = task(page, label);
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  const ordinarySize = await row.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  for (const theme of ["Light", "Dark"]) {
    await page
      .getByRole("button", { name: "Preferences", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
    await dialog
      .getByRole("combobox", { name: "Theme" })
      .selectOption({ label: theme });
    await dialog
      .getByRole("combobox", { name: "Text size" })
      .selectOption({ label: "Large" });
    await dialog.getByRole("button", { name: "Close preferences" }).click();
    await expect(row).toHaveCSS("color-scheme", theme.toLowerCase());
    await expect(row).toHaveAttribute("data-task-id", id);
    const size = await row.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    );
    expect(size).toBeGreaterThan(ordinarySize);
    expect(
      await textContrast(add),
      `${theme} capture action text`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await textContrast(row),
      `${theme} selected row text`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  const motion = await row.evaluate((element) => {
    // A nonzero requested transition makes this probe sensitive to the app's
    // reduced-motion override even when the selected component is usually still.
    element.style.transitionDuration = "4s";
    return {
      reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      duration: getComputedStyle(element).transitionDuration,
    };
  });
  expect(motion).toEqual({ reduced: true, duration: "0s" });
});
