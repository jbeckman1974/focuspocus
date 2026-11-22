import { expect, test } from "@playwright/test";
import { signIn } from "./account.ts";
import { openPlanning } from "./planning-controls.ts";

test("AT-32 · Forecast displays provider events in its returned timezone as read-only entries", async ({
  page,
}) => {
  await signIn(page, "planner");
  // A provider fixture exercises the browser presentation independently of a live calendar.
  await page.route(/\/planning\/forecast\?/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const date = data.days[0].date;
    data.viewZone = "America/Los_Angeles";
    data.days[0].events = [
      {
        id: "calendar:fixture:morning",
        title: "Crew dispatch",
        source: "Field calendar",
        allDay: false,
        start: date + "T15:45:00Z",
        end: date + "T16:00:00Z",
      },
      {
        id: "calendar:fixture:day",
        title: "Survey day",
        source: "Field calendar",
        allDay: true,
        start: date,
        end: date,
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await openPlanning(page, "Forecast");
  const events = page
    .getByRole("region", { name: "Calendar events", exact: true })
    .first();
  await expect(events.getByText("Survey day", { exact: true })).toBeVisible();
  await expect(
    events.getByRole("listitem").filter({ hasText: "Survey day" }),
  ).toContainText("All day");
  const day = await events.locator("..").getAttribute("aria-label");
  expect(day).toBeTruthy();
  const time = await page.evaluate(
    (d) =>
      new Date(d + "T15:45:00Z").toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Los_Angeles",
      }),
    day!,
  );
  await expect(
    events.getByRole("listitem").filter({ hasText: "Crew dispatch" }),
  ).toContainText(time);
  await expect(events.getByRole("button")).toHaveCount(0);
});
