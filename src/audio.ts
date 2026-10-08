import type { AudioAttachment } from "./types";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const AUDIO_MIME_TYPES = [
  "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav",
  "audio/flac", "audio/ogg", "audio/aac", "audio/x-m4a",
] as const;

export function audioMimeType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export function validateAudio(blob: Blob): string {
  const type = audioMimeType(blob.type);
  if (!(AUDIO_MIME_TYPES as readonly string[]).includes(type)) {
    throw new Error("Format audio non pris en charge. Choisis un fichier M4A, WAV, MP3, AAC, FLAC, OGG ou WebM.");
  }
  if (!blob.size) throw new Error("Le fichier audio est vide.");
  if (blob.size > MAX_AUDIO_BYTES) throw new Error("Le son doit faire 25 Mio maximum.");
  return type;
}

export function audioAttachment(blob: Blob, name: string, durationSeconds: number): AudioAttachment {
  const mimeType = validateAudio(blob);
  return {
    id: crypto.randomUUID(), name: name.slice(0, 500), mimeType,
    durationSeconds, createdAt: new Date().toISOString(),
  };
}
