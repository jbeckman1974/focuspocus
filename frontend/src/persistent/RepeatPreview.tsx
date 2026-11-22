import { useEffect, useRef, useState } from "react";
import type {
  RepeatPreviewRequest,
  RepeatPreviewResult,
  RepeatRule,
} from "./repeat.ts";
import { dateFields, describeDate } from "./schedule.ts";

export function RepeatPreview({
  id,
  rule,
  revision,
  read,
}: {
  id: string;
  rule: RepeatRule;
  revision: number;
  read: RepeatPreviewRequest;
}) {
  const request = useRef<AbortController | null>(null);
  const [sample, setSample] = useState("");
  const [output, setOutput] = useState<{
    key: string;
    result?: RepeatPreviewResult;
    message?: string;
  }>();
  const key = JSON.stringify([id, revision, rule, sample]);
  useEffect(() => () => request.current?.abort(), []);
  async function check() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setOutput({ key, message: "Checking next occurrence…" });
    try {
      const result = await read(
        id,
        rule,
        sample || undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setOutput(
        result.revision === revision
          ? { key, result }
          : {
              key,
              message:
                "The item changed. Reopen repetition to preview its current dates.",
            },
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setOutput({
          key,
          message:
            error instanceof Error
              ? error.message
              : "Could not preview this occurrence.",
        });
    }
  }
  const visible = output?.key === key ? output : undefined;
  return (
    <div className="repeat-preview">
      {rule.schedule === "completion" && (
        <label>
          Preview completion time (optional, with UTC offset)
          <input
            value={sample}
            onChange={(event) => setSample(event.currentTarget.value)}
          />
        </label>
      )}
      <button type="button" onClick={check}>
        Preview next occurrence
      </button>
      {visible?.message && <p role="status">{visible.message}</p>}
      {visible?.result && (
        <div aria-label="Next occurrence preview">
          {visible.result.next ? (
            <dl>
              {dateFields
                .filter((field) => visible.result!.next![field])
                .map((field) => (
                  <div key={field}>
                    <dt>{field}</dt>
                    <dd>{describeDate(visible.result!.next![field])}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p>No further occurrence.</p>
          )}
          {visible.result.remaining !== null && (
            <p>Remaining: {visible.result.remaining}</p>
          )}
        </div>
      )}
    </div>
  );
}
