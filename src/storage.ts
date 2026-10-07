import type { Facade, LegacyWorkspace, Workspace } from "./types";

const DATABASE_NAME = "analog-memory";
const DATABASE_VERSION = 1;
const STATE_STORE = "workspace";
const MEDIA_STORE = "media";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(STATE_STORE);
      database.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Impossible d'ouvrir le stockage local."));
  });
}

export function migrateWorkspace(saved: Workspace | LegacyWorkspace): Workspace {
  if ("version" in saved && saved.version === 2) return saved;
  const legacy = saved as LegacyWorkspace;
  const current: Facade = {
    id: crypto.randomUUID(),
    name: "Façade 1",
    createdAt: new Date().toISOString(),
    photoId: legacy.module.photoId,
    values: { ...legacy.module.values },
    model: legacy.module.model,
    notes: legacy.module.notes,
    cables: legacy.module.cables ?? [],
    recordings: legacy.module.recordings ?? [],
  };
  const fromSnapshots: Facade[] = (legacy.snapshots ?? []).slice().reverse().map((snapshot, index) => ({
    id: snapshot.id,
    name: `Instantané ${index + 1}`,
    createdAt: snapshot.createdAt,
    values: { ...snapshot.values },
    model: snapshot.model,
    notes: snapshot.notes,
    cables: snapshot.cables ?? [],
    recordings: [],
  }));
  return {
    version: 2,
    set: legacy.set,
    module: {
      name: legacy.module.name,
      manufacturer: legacy.module.manufacturer,
      facades: [current, ...fromSnapshots],
      activeFacadeId: current.id,
    },
  };
}

export async function loadWorkspace(): Promise<Workspace | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STATE_STORE, "readonly").objectStore(STATE_STORE).get("current");
    request.onsuccess = () => {
      database.close();
      const saved = request.result as Workspace | LegacyWorkspace | undefined;
      resolve(saved ? migrateWorkspace(saved) : undefined);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Impossible de lire les données enregistrées."));
    };
  });
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, "readwrite");
    transaction.objectStore(STATE_STORE).put(workspace, "current");
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Impossible d'enregistrer les données."));
    };
  });
}

export async function saveMedia(id: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    transaction.objectStore(MEDIA_STORE).put(blob, id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Impossible d'enregistrer le fichier."));
    };
  });
}

export async function loadMedia(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(MEDIA_STORE, "readonly").objectStore(MEDIA_STORE).get(id);
    request.onsuccess = () => {
      database.close();
      resolve(request.result as Blob | undefined);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Impossible de lire le fichier enregistré."));
    };
  });
}

export async function deleteMedia(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Impossible de supprimer le fichier."));
    };
  });
}
