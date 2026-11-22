import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

interface Props {
  label: string;
  controls: string;
  side: "left" | "right";
  size: number;
  min: number;
  max: number;
  setSize: (size: number) => void;
}

export function PaneDivider({
  label,
  controls,
  side,
  size,
  min,
  max,
  setSize,
}: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const direction = side === "left" ? 1 : -1;
  const clamp = (value: number) =>
    Math.min(max, Math.max(min, Math.round(value)));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 32 : 8;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = size - step * direction;
        break;
      case "ArrowRight":
        next = size + step * direction;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSize(clamp(next));
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    drag.current = { x: event.clientX, width: size };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setSize(
      clamp(drag.current.width + (event.clientX - drag.current.x) * direction),
    );
  }

  return (
    <div
      className="fp-splitter"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      aria-valuetext={`${size} pixels`}
      onKeyDown={onKeyDown}
      onPointerDown={start}
      onPointerMove={move}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
