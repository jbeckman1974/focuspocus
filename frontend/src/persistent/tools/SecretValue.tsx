import { useEffect } from "react";

export function SecretValue({
  value,
  label,
  clear,
}: {
  value: string;
  label: string;
  clear: () => void;
}) {
  useEffect(() => {
    function hidden() {
      if (document.hidden) clear();
    }
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [clear]);
  return (
    <fieldset>
      <legend>{label}</legend>
      <p>Copy this value now. Closing this view hides it.</p>
      <input
        className="secret"
        aria-label={label}
        readOnly
        autoComplete="off"
        value={value}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" onClick={clear}>
        Hide code
      </button>
    </fieldset>
  );
}
