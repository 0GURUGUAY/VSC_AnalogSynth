import type { PatchCable } from "./types";

export function PatchMidiSettings({ cable, label, onChange }: {
  cable: Omit<PatchCable, "id">;
  label: string;
  onChange: (update: Partial<Omit<PatchCable, "id">>) => void;
}) {
  return (
    <div className="cable-midi-settings">
      <label>Canal MIDI
        <select value={cable.midiChannel ?? ""} aria-label={`Canal MIDI ${label}`} onChange={(event) => onChange({ midiChannel: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">Non défini / sans MIDI</option>
          {Array.from({ length: 16 }, (_, index) => index + 1).map((channel) => <option key={channel} value={channel}>Canal {channel}</option>)}
        </select>
      </label>
      <label className="cable-clock-toggle">
        <input type="checkbox" checked={cable.carriesClock ?? false} aria-label={`Diffuser MASTER CLOCK ${label}`} onChange={(event) => onChange({ carriesClock: event.target.checked })} />
        Diffuser MASTER CLOCK
      </label>
    </div>
  );
}
