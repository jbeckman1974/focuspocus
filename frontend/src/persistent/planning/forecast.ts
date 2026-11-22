export interface ForecastOptions {
  start: string; days: number; layout: "grouped" | "combined";
  planned: boolean; deferred: boolean; flagged: boolean; includeHeld: boolean; tagId: string;
}
export const forecastDefaults: ForecastOptions = {
  start: "", days: 7, layout: "grouped", planned: true, deferred: false,
  flagged: false, includeHeld: false, tagId: "",
};
export const sectionNames: Record<string, string> = {
  due: "Due", overdue: "Overdue", planned: "Planned", deferred: "Deferred",
  tagged: "Tagged", flagged: "Flagged", combined: "Tasks",
};
export function forecastPath(options: ForecastOptions, zone: string) {
  const query = new URLSearchParams();
  if (options.start) query.set("start", options.start);
  query.set("days", String(options.days));
  query.set("layout", options.layout);
  for (const field of ["planned","deferred","flagged","includeHeld"] as const)
    query.set(field, options[field] ? "1" : "0");
  if (options.tagId) query.set("tagId", options.tagId);
  if (zone) query.set("viewZone", zone);
  return "planning/forecast?" + query;
}
