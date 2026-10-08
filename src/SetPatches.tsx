import { Plus, Trash2 } from "lucide-react";
import type { Workspace } from "./types";

export function SetPatches({ workspace, disabled, onChange, onSelect }: {
  workspace: Workspace;
  disabled: boolean;
  onChange: (workspace: Workspace) => void;
  onSelect: (patchId: string) => void;
}) {
  const patches = workspace.patches ?? [];
  const active = patches.find((patch) => patch.id === workspace.activePatchId);
  if (!active) return null;

  function addPatch() {
    const id = crypto.randomUUID();
    onChange({
      ...workspace,
      patches: [...patches, { id, name: `PATCH ${patches.length + 1}`, notes: "", moduleInstanceIds: [] }],
      activePatchId: id,
      module: { ...workspace.module, activeFacadeId: "" },
    });
  }

  function removePatch() {
    if (!active || patches.length < 2) return;
    if (!window.confirm(`Retirer le PATCH « ${active.name} » ? Ses modules, réglages, sons et câbles seront conservés dans un autre PATCH.`)) return;
    const remaining = patches.filter((patch) => patch.id !== active.id);
    const target = remaining[0];
    onChange({
      ...workspace,
      patches: remaining.map((patch) => patch.id === target.id
        ? { ...patch, moduleInstanceIds: [...patch.moduleInstanceIds, ...active.moduleInstanceIds] } : patch),
      activePatchId: target.id,
      module: { ...workspace.module, activeFacadeId: target.moduleInstanceIds[0] ?? active.moduleInstanceIds[0] ?? "" },
    });
  }

  return <section className="set-patches" aria-label="PATCHES du SET">
    <div className="section-heading">
      <div><span className="eyebrow">{patches.length} PATCH{patches.length > 1 ? "ES" : ""}</span><h2>Groupements de modules</h2></div>
      <button className="outline-button" disabled={disabled || patches.length >= 100} onClick={addPatch}><Plus size={15} /> Nouveau PATCH</button>
    </div>
    <div className="set-patch-tabs">
      {patches.map((patch) => <button key={patch.id} className="outline-button" aria-pressed={patch.id === active.id}
        disabled={disabled} onClick={() => onSelect(patch.id)}>{patch.name} · {patch.moduleInstanceIds.length} modules</button>)}
    </div>
    <div className="theme-fields">
      <label>Nom du PATCH<input maxLength={500} value={active.name} disabled={disabled} onChange={(event) => onChange({
        ...workspace, patches: patches.map((patch) => patch.id === active.id ? { ...patch, name: event.target.value } : patch),
      })} /></label>
      <label>Notes du PATCH<textarea maxLength={10000} value={active.notes} disabled={disabled} onChange={(event) => onChange({
        ...workspace, patches: patches.map((patch) => patch.id === active.id ? { ...patch, notes: event.target.value } : patch),
      })} /></label>
    </div>
    <p>Les nouveaux modules sont ajoutés au PATCH sélectionné. Le câblage peut relier tous les PATCHES du SET.</p>
    <button className="text-button danger-text" disabled={disabled || patches.length < 2} onClick={removePatch}><Trash2 size={14} /> Retirer ce PATCH (conserver les modules)</button>
  </section>;
}
