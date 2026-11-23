import { Icon } from "../frame/Icon.tsx";
import {
  chooseTaskLayout,
  taskLayouts,
  type TaskLayout,
} from "../../workspace/taskLayout.ts";

const labels = { list: "List", board: "Board", calendar: "Calendar" } as const;
const icons = { list: "all", board: "board", calendar: "calendar" } as const;

export function LayoutSwitch({ layout }: { layout: TaskLayout }) {
  return (
    <div className="task-layout-switch" role="group" aria-label="Task view">
      {taskLayouts.map((mode, i) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === layout}
          onClick={() => chooseTaskLayout(mode)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 2
                  : (i +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      taskLayouts.length) %
                    taskLayouts.length;
            event.currentTarget.parentElement
              ?.querySelectorAll("button")
              [index]?.focus();
            chooseTaskLayout(taskLayouts[index]!);
          }}
        >
          <Icon name={icons[mode]} size={18} />
          {labels[mode]}
        </button>
      ))}
    </div>
  );
}
