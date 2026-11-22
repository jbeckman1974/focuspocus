import { useState } from "react";
import type { Entry } from "../outline/index.ts";
import type { Snapshot } from "./api.ts";
import type { WorkspaceChannel } from "./channel.ts";
import { RuleControls } from "./RuleControls.tsx";
import type { Properties, RuleFields } from "./rules.ts";
import { RepeatDialog } from "./RepeatDialog.tsx";
import { ScheduleDialog } from "./ScheduleDialog.tsx";

export function ItemTools({
  entry,
  kind,
  snapshot,
  channel,
  pending,
  disabled,
  showSource,
}: {
  entry: Entry & RuleFields;
  kind: "project" | "group" | "folder" | "action";
  snapshot: Snapshot;
  channel: WorkspaceChannel;
  pending?: Properties;
  disabled: boolean;
  showSource:(id:string)=>void;
}) {
  const [editor, setEditor] = useState<{
    type: "schedule" | "repeat";
    base: Snapshot;
    item: Entry & RuleFields;
  }>();
  function sourceLink(id:string|null|undefined) {
    if(!id || id===entry.id) return null;
    const source=[...snapshot.projects,...snapshot.tasks,...snapshot.tags,...(snapshot.folders ?? [])].find(item=>item.id===id);
    return source ? <button type="button" onClick={()=>showSource(id)}>{source.title}</button> : null;
  }
  return (
    <div className="item-tools">
      <RuleControls
        sourceLink={sourceLink}
        entry={entry}
        kind={kind}
        pending={pending}
        disabled={disabled}
        change={(properties) =>
          channel.run({ type: "set-properties", ids: [entry.id], properties })
        }
      />
      {kind !== "folder" && (
        <button
          disabled={disabled}
          onClick={() =>
            setEditor({ type: "schedule", base: snapshot, item: entry })
          }
        >
          Schedule…
        </button>
      )}
      {kind !== "folder" && (
        <button
          disabled={disabled}
          onClick={() =>
            setEditor({ type: "repeat", base: snapshot, item: entry })
          }
        >
          Repeat…
        </button>
      )}
      {editor?.type === "repeat" && (
        <RepeatDialog
          revision={editor.base.revision}
          preview={channel.previewRepeat}
          entry={editor.item}
          close={() => setEditor(undefined)}
          apply={(change) =>
            channel.run({ type: "repeat", change }, editor.base)
          }
        />
      )}
      {editor?.type === "schedule" && (
        <ScheduleDialog
          showSource={(id)=>{setEditor(undefined);showSource(id);}}
          base={editor.base}
          entry={editor.item}
          close={() => setEditor(undefined)}
          apply={(changes) =>
            channel.run(
              { type: "set-schedule", ids: [editor.item.id], changes },
              editor.base,
            )
          }
        />
      )}
    </div>
  );
}
