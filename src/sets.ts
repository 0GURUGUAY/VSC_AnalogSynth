import type { Facade, MusicPatch, PatchCable, Workspace } from "./types";
import { migratePatchMidi } from "./patch";
import { jackDirection } from "./ports";

export function instanceLabel(facade: Facade, fallbackModule: string): string {
  const moduleName = facade.moduleName ?? fallbackModule;
  return moduleName === facade.name ? moduleName : `${moduleName} (${facade.name})`;
}

export function orderedPatchFacades(facades: Facade[], patch: MusicPatch | undefined): Facade[] {
  const byId = new Map(facades.map((facade) => [facade.id, facade]));
  return (patch?.moduleInstanceIds ?? []).flatMap((id) => {
    const facade = byId.get(id);
    return facade ? [facade] : [];
  });
}

export function reorderPatchModule(workspace: Workspace, patchId: string, instanceId: string, targetId: string, position: "before" | "after"): Workspace {
  const patch = workspace.patches?.find((candidate) => candidate.id === patchId);
  if (!patch || !patch.moduleInstanceIds.includes(instanceId) || !patch.moduleInstanceIds.includes(targetId)) {
    throw new Error("Module ou PATCH introuvable.");
  }
  if (instanceId === targetId) return workspace;
  const ids = patch.moduleInstanceIds.filter((id) => id !== instanceId);
  ids.splice(ids.indexOf(targetId) + (position === "after" ? 1 : 0), 0, instanceId);
  if (ids.every((id, index) => id === patch.moduleInstanceIds[index])) return workspace;
  return {
    ...workspace,
    patches: workspace.patches?.map((candidate) => candidate.id === patchId
      ? { ...candidate, moduleInstanceIds: ids } : candidate),
  };
}

function legacyInstanceLabel(facade: Facade, fallbackModule: string): string {
  return `${facade.moduleName ?? fallbackModule} (${facade.name} · ${facade.id.slice(0, 8)})`;
}

function cableInstanceLabels(facades: Facade[], fallbackModule: string): Map<string, string> {
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  facades.forEach((facade) => {
    const label = instanceLabel(facade, fallbackModule);
    totals.set(label, (totals.get(label) ?? 0) + 1);
  });
  return new Map(facades.map((facade) => {
    const label = instanceLabel(facade, fallbackModule);
    const index = (counts.get(label) ?? 0) + 1;
    counts.set(label, index);
    return [facade.id, (totals.get(label) ?? 0) > 1 ? `${label} · ${index}` : label];
  }));
}

export function cableOptions(facades: Facade[], direction: "input" | "output", fallbackModule: string, instanceId?: string): string[] {
  const labels = cableInstanceLabels(facades, fallbackModule);
  return facades.filter((facade) => !instanceId || facade.id === instanceId).flatMap((facade) =>
    (facade.jacks ?? []).filter((jack) => jack.label.trim() && [direction, "bidirectional"].includes(jackDirection(jack)))
      .map((jack) => `${labels.get(facade.id)} ${direction === "output" ? "OUT" : "IN"} ${jack.label}`));
}

export function resolveCable(cable: Omit<PatchCable, "id">, facades: Facade[], fallbackModule: string): Omit<PatchCable, "id"> {
  const result = { ...cable };
  const labels = cableInstanceLabels(facades, fallbackModule);
  for (const [side, direction] of [["source", "output"], ["destination", "input"]] as const) {
    const instanceKey = side === "source" ? "sourceInstanceId" : "destinationInstanceId";
    const portKey = side === "source" ? "sourcePortId" : "destinationPortId";
    const owner = facades.find((facade) => (facade.jacks ?? []).some((jack) => {
      if (!jack.label.trim() || ![direction, "bidirectional"].includes(jackDirection(jack))) return false;
      const suffix = `${direction === "output" ? "OUT" : "IN"} ${jack.label}`;
      return `${labels.get(facade.id)} ${suffix}` === cable[side]
        || `${legacyInstanceLabel(facade, fallbackModule)} ${suffix}` === cable[side];
    }));
    const port = owner?.jacks?.find((jack) => {
      if (!jack.label.trim() || ![direction, "bidirectional"].includes(jackDirection(jack))) return false;
      const endpoint = `${labels.get(owner.id)} ${direction === "output" ? "OUT" : "IN"} ${jack.label}`;
      const legacyEndpoint = `${legacyInstanceLabel(owner, fallbackModule)} ${direction === "output" ? "OUT" : "IN"} ${jack.label}`;
      return endpoint === cable[side] || legacyEndpoint === cable[side];
    });
    if (owner && port) {
      result[instanceKey] = owner.id;
      result[portKey] = port.id;
    } else {
      delete result[instanceKey];
      delete result[portKey];
    }
  }
  return result;
}

export function cableEndpoint(cable: PatchCable, side: "source" | "destination", facades: Facade[], fallbackModule: string): string {
  const id = side === "source" ? cable.sourceInstanceId : cable.destinationInstanceId;
  const portId = side === "source" ? cable.sourcePortId : cable.destinationPortId;
  const owner = facades.find((facade) => facade.id === id);
  const port = owner?.jacks?.find((jack) => jack.id === portId);
  if (owner && port) {
    const labels = cableInstanceLabels(facades, fallbackModule);
    return `${labels.get(owner.id)} ${side === "source" ? "OUT" : "IN"} ${port.label}`;
  }
  return cable[side].replace(/ · [a-f\d]{8}(?=\))/gi, "");
}

/** Keep legacy media and module identifiers stable during the upgrade. */
export function migrateSet(workspace: Workspace): Workspace {
  const migrated = migratePatchMidi(workspace);
  if (workspace.version === 3) return migrated;
  return {
    ...migrated,
    version: 3,
    patches: [{
      id: workspace.set.id,
      name: workspace.set.name,
      notes: "",
      moduleInstanceIds: workspace.module.facades.map((facade) => facade.id),
    }],
    activePatchId: workspace.set.id,
  };
}

export function assignModuleToPatch(workspace: Workspace, instanceId: string, patchId: string): Workspace {
  if (!workspace.module.facades.some((facade) => facade.id === instanceId)
    || !workspace.patches?.some((patch) => patch.id === patchId)) {
    throw new Error("Module ou PATCH introuvable.");
  }
  return {
    ...workspace,
    patches: workspace.patches.map((patch) => ({
      ...patch,
      moduleInstanceIds: [
        ...patch.moduleInstanceIds.filter((id) => id !== instanceId),
        ...(patch.id === patchId ? [instanceId] : []),
      ],
    })),
  };
}
