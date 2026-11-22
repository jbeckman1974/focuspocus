import type { PersonalSettings, AccountSettings } from "./types.ts";
import { dateFields } from "../schedule.ts";

export function PersonalControls({ settings }: { settings: PersonalSettings }) {
  const { account, setAccount } = settings;
  return (
    <>
      <label className="fp-field">Motion
        <select aria-label="Motion" value={account.motion} onChange={(e) => setAccount({ motion: e.target.value as AccountSettings["motion"] })}>
          <option value="system">Use system setting</option>
          <option value="reduced">Reduce motion</option>
        </select>
      </label>
      <label className="fp-field">Completion shortcut
        <select aria-label="Completion shortcut" value={account.shortcut} onChange={(e) => setAccount({ shortcut: e.target.value as AccountSettings["shortcut"] })}>
          {["x", "c", "k"].map((key) => <option key={key} value={key}>{key.toUpperCase()}</option>)}
        </select>
      </label>
      {dateFields.map((field) => (
        <div key={field}>
          <label className="fp-field">
            Personal default {field} time
            <input type="time" aria-label={`Personal default ${field} time`}
              value={account.dateDefaults[field]} onChange={(e) => {
                if (e.target.value) setAccount({ dateDefaults: { [field]: e.target.value } });
              }} />
          </label>
          <button type="button" onClick={() => setAccount({ dateDefaults: { [field]: null } })}>
            Use workspace default for {field}
          </button>
        </div>
      ))}
      {settings.message && <p role="status">{settings.message}</p>}
      {settings.retry && <button type="button" onClick={settings.retry}>Reapply my changes</button>}
      {settings.discard && <button type="button" onClick={settings.discard}>Reload saved preferences</button>}
    </>
  );
}
