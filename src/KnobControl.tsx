import type { CSSProperties } from "react";
import type { ControlDef } from "./types";

export function KnobControl({
  control,
  value,
  onChange,
  disabled = false,
}: {
  control: ControlDef;
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const angle = value === null ? -150 : -150 + (value / 100) * 300;
  const isSlider = control.kind === "slider";
  return (
    <label className={`control-card ${isSlider ? "slider-card" : ""}`}>
      <span className="control-name">{control.label}</span>
      {isSlider ? (
        <span className="fader-shell" style={{ "--fader-pos": `${value ?? 50}%` } as CSSProperties} aria-hidden="true">
          <span className="fader-track" />
          <span className={`fader-cap ${value === null ? "unknown" : ""}`} />
        </span>
      ) : <span className="knob-shell" style={{ "--knob-angle": `${angle}deg`, "--knob-progress": `${value === null ? 0 : value * 3}deg` } as CSSProperties} aria-hidden="true">
        <span className="knob" />
        <span className="knob-pointer" />
      </span>}
      <span className={`control-value ${value === null ? "unknown" : ""}`}>{value === null ? "À saisir" : `${value}%`}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        disabled={disabled}
        value={value ?? 50}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`${control.label} : ${value === null ? "non renseigné" : `${value}%`}`}
      />
      <span className="control-hint">{control.hint}</span>
    </label>
  );
}
