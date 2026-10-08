import type { LibraryModule, ModulePreset } from "./types";

export type ModuleSort = "name" | "recent";

export function findLibraryModules(modules: LibraryModule[], query: string, sort: ModuleSort): LibraryModule[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return modules.filter((module) => {
    const text = normalize(`${module.name} ${module.manufacturer} ${module.model}`);
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => sort === "recent"
    ? b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, "fr", { numeric: true })
    : a.name.localeCompare(b.name, "fr", { numeric: true }));
}

export function prepareModuleForPhoto(module: LibraryModule): LibraryModule {
  return { ...module, name: module.name.trim() || "Nouveau module" };
}

export function prepareThemePreset(
  name: string,
  values: ModulePreset["values"],
  notes: string,
  existing?: ModulePreset,
): ModulePreset {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Donne un nom à ce preset.");
  const original = existing?.name.trim() === trimmedName ? existing : undefined;
  const now = new Date().toISOString();
  return {
    id: original?.id ?? crypto.randomUUID(),
    name: trimmedName,
    values: { ...values },
    notes,
    createdAt: original?.createdAt ?? now,
    updatedAt: now,
    ...(original?.audio ? { audio: { ...original.audio } } : {}),
  };
}
