import type { Facade, Workspace } from "./types";

export function migratePatchMidi(workspace: Workspace): Workspace {
  return {
    ...workspace,
    module: {
      ...workspace.module,
      facades: workspace.module.facades.map(({ midiChannel, ...facade }) => ({
        ...facade,
        cables: facade.cables.map((cable) => midiChannel !== undefined && cable.midiChannel === undefined
          ? { ...cable, midiChannel }
          : cable),
      })),
    },
  };
}

export function masterClockLabel(facades: Facade[], id: string | undefined, fallbackModule: string): string {
  const master = facades.find((facade) => facade.id === id);
  return master ? `${master.moduleName ?? fallbackModule} · ${master.name}` : "Non défini";
}

export function clearRemovedMasterClock(workspace: Workspace, facadeId: string): Workspace["set"] {
  if (workspace.set.masterClockFacadeId !== facadeId) return workspace.set;
  const { masterClockFacadeId: _removed, ...set } = workspace.set;
  return set;
}
