import { Button, Field, Input, Select } from "@fluentui/react-components";
import type { PersonalSettings, AccountSettings } from "./types.ts";
import { dateFields } from "../schedule.ts";

const names = { defer: "Defer", planned: "Planned", due: "Due" } as const;

export function PersonalControls({ settings }: { settings: PersonalSettings }) {
  const { account, setAccount } = settings;
  return (
    <>
      <section
        className="fp-preference-section"
        aria-labelledby="interaction-heading"
      >
        <h3 id="interaction-heading">Keyboard and motion</h3>
        <div className="fp-preference-grid">
          <Field label="Completion shortcut">
            <Select
              value={account.shortcut}
              onChange={(e) =>
                setAccount({
                  shortcut: e.currentTarget
                    .value as AccountSettings["shortcut"],
                })
              }
            >
              {["x", "c", "k"].map((key) => (
                <option key={key} value={key}>
                  {key.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Motion">
            <Select
              value={account.motion}
              onChange={(e) =>
                setAccount({
                  motion: e.currentTarget.value as AccountSettings["motion"],
                })
              }
            >
              <option value="system">Use system setting</option>
              <option value="reduced">Reduce motion</option>
            </Select>
          </Field>
        </div>
      </section>
      <section
        className="fp-preference-section"
        aria-labelledby="default-times-heading"
      >
        <h3 id="default-times-heading">Default times</h3>
        <div className="fp-preference-times">
          {dateFields.map((field) => (
            <div key={field}>
              <Field label={names[field]}>
                <Input
                  type="time"
                  aria-label={`Personal default ${field} time`}
                  value={account.dateDefaults[field]}
                  onChange={(_, data) => {
                    if (data.value)
                      setAccount({ dateDefaults: { [field]: data.value } });
                  }}
                />
              </Field>
              <Button
                appearance="transparent"
                size="small"
                aria-label={`Use workspace default for ${field}`}
                onClick={() => setAccount({ dateDefaults: { [field]: null } })}
              >
                Use workspace default
              </Button>
            </div>
          ))}
        </div>
      </section>
      {settings.message && <p role="status">{settings.message}</p>}
      {(settings.retry || settings.discard) && (
        <div className="fp-preference-retry">
          {settings.retry && (
            <Button onClick={settings.retry}>Reapply my changes</Button>
          )}
          {settings.discard && (
            <Button onClick={settings.discard}>Reload saved preferences</Button>
          )}
        </div>
      )}
    </>
  );
}
