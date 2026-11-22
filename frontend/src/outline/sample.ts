import { INBOX } from "./types.ts";
import type { Task, Workspace } from "./types.ts";
import { newTask } from "./values.ts";

// Stable comparison labels match the synthetic reference workspace. Extra Inbox rows exercise scrolling.
const inboxTitles = [
  "Loose receipt",
  "Untagged insert",
  "Pretagged insert",
  "Check last week's mileage",
  "Refill the field bag",
  "Confirm the site entrance",
  "Order replacement flags",
  "File the access sketch",
  "Set out fresh batteries",
  "Return the borrowed tripod",
  "Transcribe the station notes",
  "Update the equipment log",
  "Check the route map",
  "Restock the marking chalk",
  "Print the field index",
  "Review the traverse closure",
  "Label the reference photos",
  "Collect the spare prism",
  "Send the visit summary",
  "Book a drafting desk",
  "Confirm the return window",
  "Sort the field sketches",
  "Check the case inventory",
  "Archive the finished sheet",
];

function sampleTask(
  id: string,
  parent: string,
  title: string,
  properties: Partial<Pick<Task, "kind" | "tags" | "done" | "due">> = {},
): Task {
  return { ...newTask(id, parent, title), ...properties };
}

export function createSample(): Workspace {
  const inbox = inboxTitles.map((title, index) =>
    sampleTask(
      `I${String(index + 1).padStart(2, "0")}`,
      INBOX,
      title,
      index === 2 ? { tags: ["desk"] } : {},
    ),
  );
  return {
    projects: [
      { id: "P01", title: "Control traverse" },
      { id: "P03", title: "Punch list" },
    ],
    tags: [
      { id: "field", title: "Field" },
      { id: "desk", title: "Desk" },
      { id: "reference", title: "Reference" },
    ],
    tasks: [
      ...inbox,
      sampleTask("A01", "P01", "Clear gate", { tags: ["field"] }),
      sampleTask("A02", "P01", "Mark station", { tags: ["field"] }),
      sampleTask("G01", "P01", "Tie shots", { kind: "group" }),
      sampleTask("A03", "G01", "East tie"),
      sampleTask("A04", "G01", "West tie"),
      sampleTask("A05", "P01", "File return", { tags: ["desk"] }),
      sampleTask("A11", "P03", "Battery", { done: true }),
      sampleTask("A12", "P03", "Photos", { tags: ["field"] }),
      sampleTask("A13", "P03", "Café ledger", { tags: ["reference"] }),
    ],
  };
}
