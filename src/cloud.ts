import { Capacitor } from "@capacitor/core";
import type { AudioAttachment, LibraryModule, ModulePreset, Workspace } from "./types";
import { migrateSet } from "./sets";

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
  || "65609223509-pnajgji06fkf09c29ncll5tafkmjtbio.apps.googleusercontent.com";
export const CLOUD_URL = "https://analog-memory-65609223509.us-central1.run.app";

function apiUrl(path: string): string {
  const configured = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "");
  const base = configured || (Capacitor.isNativePlatform() ? CLOUD_URL : "");
  return `${base}${path}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const type = response.headers.get("content-type") ?? "";
  let body: unknown;
  if (/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(type)) {
    body = await response.json();
  } else {
    throw new Error(`Le serveur a renvoyé une réponse non JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : `La requête cloud a échoué (HTTP ${response.status}).`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body as T;
}

export async function cloudRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (error) {
    throw new Error("Impossible de joindre Cloud Run. Vérifie ta connexion Internet.", { cause: error });
  }
  return readResponse<T>(response);
}

export type CloudIdentity = { sub: string; email?: string; name?: string };
export type GeminiSettings = { configured: boolean; serverAvailable: boolean };

export function readGeminiSettings(token: string): Promise<GeminiSettings> {
  return cloudRequest(token, "/api/settings/gemini");
}

export function writeGeminiSettings(token: string, apiKey: string | null): Promise<GeminiSettings> {
  return cloudRequest(token, "/api/settings/gemini", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }),
  });
}
export type CloudTheme = {
  id: string;
  set: Workspace["set"];
  revision: number;
  updatedAt: string;
};
export type CloudThemeRecord = { workspace: Workspace; revision: number; updatedAt: string };

export async function listCloudModules(token: string): Promise<LibraryModule[]> {
  const result = await cloudRequest<{ modules: LibraryModule[] }>(token, "/api/modules");
  return result.modules;
}

export async function writeCloudModule(token: string, module: LibraryModule): Promise<LibraryModule> {
  const result = await cloudRequest<{ module: LibraryModule }>(token, `/api/modules/${encodeURIComponent(module.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(module),
  });
  return result.module;
}

export async function listCloudPresets(token: string, moduleId: string): Promise<ModulePreset[]> {
  const result = await cloudRequest<{ presets: ModulePreset[] }>(token, `/api/modules/${encodeURIComponent(moduleId)}/presets`);
  return result.presets;
}

export async function writeCloudPreset(token: string, moduleId: string, preset: ModulePreset): Promise<ModulePreset> {
  const result = await cloudRequest<{ preset: ModulePreset }>(token, `/api/modules/${encodeURIComponent(moduleId)}/presets/${encodeURIComponent(preset.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset),
  });
  return result.preset;
}

export async function writeCloudPresetAudio(token: string, moduleId: string, presetId: string, audio: AudioAttachment | null): Promise<ModulePreset> {
  const result = await cloudRequest<{ preset: ModulePreset }>(token, `/api/modules/${encodeURIComponent(moduleId)}/presets/${encodeURIComponent(presetId)}/audio`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio }),
  });
  return result.preset;
}

export async function fetchCloudModuleMedia(token: string, moduleId: string, mediaId: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/api/modules/${encodeURIComponent(moduleId)}/media/${encodeURIComponent(mediaId)}`), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    await readResponse<never>(response);
    throw new Error(`Téléchargement du média impossible (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Le serveur a renvoyé un média vide.");
  return blob;
}

export async function putCloudModuleMedia(token: string, moduleId: string, mediaId: string, blob: Blob): Promise<void> {
  const response = await fetch(apiUrl(`/api/modules/${encodeURIComponent(moduleId)}/media/${encodeURIComponent(mediaId)}`), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "X-Media-Type": blob.type },
    body: blob,
    cache: "no-store",
  });
  await readResponse<{ id: string }>(response);
}

export async function verifyCloudSession(token: string): Promise<CloudIdentity> {
  return cloudRequest<CloudIdentity>(token, "/api/auth/me");
}

export async function listCloudThemes(token: string): Promise<CloudTheme[]> {
  const result = await cloudRequest<{ sets: CloudTheme[] }>(token, "/api/sets");
  return result.sets;
}

export async function readCloudTheme(token: string, id: string): Promise<CloudThemeRecord> {
  const result = await cloudRequest<CloudThemeRecord>(token, `/api/sets/${encodeURIComponent(id)}`);
  return { ...result, workspace: migrateSet(result.workspace) };
}

export async function writeCloudTheme(token: string, workspace: Workspace, revision: number, create: boolean): Promise<CloudThemeRecord> {
  return cloudRequest<CloudThemeRecord>(token, create ? "/api/sets" : `/api/sets/${encodeURIComponent(workspace.set.id)}`, {
    method: create ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, revision }),
  });
}

export type CloudMedia = { id: string; blob: Blob };

export function workspaceMedia(workspace: Workspace): { id: string; mimeType: string }[] {
  return [
    ...(workspace.set.midiFiles ?? []).map((file) => ({ id: file.id, mimeType: file.mimeType })),
    ...workspace.module.facades.flatMap((facade) => [
      ...(facade.photoId && !facade.moduleId ? [{ id: facade.photoId, mimeType: "image/jpeg" }] : []),
      ...facade.recordings.map((recording) => ({ id: recording.id, mimeType: recording.mimeType })),
    ]),
  ];
}

export async function fetchCloudMedia(token: string, themeId: string, mediaId: string): Promise<Blob> {
  const file = await fetch(apiUrl(`/api/sets/${encodeURIComponent(themeId)}/media/${encodeURIComponent(mediaId)}`), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!file.ok) {
    await readResponse<never>(file);
    throw new Error(`Téléchargement du média impossible (HTTP ${file.status}).`);
  }
  const blob = await file.blob();
  if (!blob.size) throw new Error("Le serveur a renvoyé un média vide.");
  return blob;
}

export async function putCloudMedia(token: string, themeId: string, mediaId: string, blob: Blob): Promise<void> {
  const response = await fetch(apiUrl(`/api/sets/${encodeURIComponent(themeId)}/media/${encodeURIComponent(mediaId)}`), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "X-Media-Type": blob.type },
    body: blob,
    cache: "no-store",
  });
  if (response.status === 409) {
    const existing = await fetchCloudMedia(token, themeId, mediaId);
    const [oldBytes, newBytes] = await Promise.all([existing.arrayBuffer(), blob.arrayBuffer()]);
    const oldContent = new Uint8Array(oldBytes);
    const newContent = new Uint8Array(newBytes);
    if (oldContent.byteLength === newContent.byteLength && oldContent.every((byte, index) => byte === newContent[index])) return;
  }
  await readResponse<{ id: string }>(response);
}
