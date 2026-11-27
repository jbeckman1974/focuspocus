import { INBOX, type TaskLocationEntry } from "../outline/types.ts";
import { Icon } from "./frame/Icon.tsx";
import "./taskLocation.css";

export function TaskLocation({
  location,
  id,
}: {
  location: TaskLocationEntry;
  id?: string;
}) {
  const inbox = location.id === INBOX;
  return (
    <span className="task-location" id={id}>
      <Icon name={inbox ? "inbox" : "projects"} size={14} />
      {!inbox && <span className="outline-visually-hidden">Project: </span>}
      <span className="task-location-name">{location.title}</span>
      {location.filingTarget && (
        <>
          <span aria-hidden="true">→</span>
          <span className="outline-visually-hidden">Assigned to project: </span>
          <span className="task-location-name">
            {location.filingTarget.title}
          </span>
        </>
      )}
    </span>
  );
}
