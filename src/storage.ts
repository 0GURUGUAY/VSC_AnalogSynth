import type { Workspace } from "./types";

const mediaCache = new Map<string, Blob>();
let cloudMediaLoader: ((id: string) => Promise<Blob>) | undefined;

export function configureCloudMediaSession(loader: (id: string) => Promise<Blob>): void {
  cloudMediaLoader = loader;
  mediaCache.clear();
}

export function configureCloudWorkspaceMediaSession(
  getWorkspace: () => Workspace,
  loadThemeMedia: (id: string) => Promise<Blob>,
  loadModuleMedia: (moduleId: string, id: string) => Promise<Blob>,
): void {
  configureCloudMediaSession((id) => {
    const facade = getWorkspace().module.facades.find((item) => item.moduleId && item.photoId === id);
    return facade?.moduleId ? loadModuleMedia(facade.moduleId, id) : loadThemeMedia(id);
  });
}

export function clearCloudMediaSession(): void {
  cloudMediaLoader = undefined;
  mediaCache.clear();
}

export async function deleteLocalData(): Promise<void> {
  if (!("indexedDB" in globalThis)) return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("analog-memory");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Impossible de supprimer les anciennes données locales."));
    request.onblocked = () => reject(new Error("Ferme les autres onglets Analog Memory puis recharge cette page pour supprimer les anciennes données locales."));
  });
}

export async function saveMedia(id: string, blob: Blob): Promise<void> {
  mediaCache.set(id, blob);
}

export async function loadMedia(id: string): Promise<Blob | undefined> {
  const cached = mediaCache.get(id);
  if (cached) return cached;
  if (!cloudMediaLoader) throw new Error("Connecte-toi et ouvre un SET cloud avant d'accéder aux médias.");
  const blob = await cloudMediaLoader(id);
  mediaCache.set(id, blob);
  return blob;
}

export async function deleteMedia(ids: string[]): Promise<void> {
  ids.forEach((id) => mediaCache.delete(id));
}
