import assert from "node:assert/strict";
import test from "node:test";
import { audioAttachment, audioMimeType, validateAudio, MAX_AUDIO_BYTES, AUDIO_MIME_TYPES } from "../src/audio.ts";
import { prepareThemePreset } from "../src/library.ts";

test("audio : formats mobiles et codecs normalisés, fichiers vides et limites exactes", () => {
  assert.equal(audioMimeType("Audio/WebM;codecs=opus"), "audio/webm");
  for (const type of AUDIO_MIME_TYPES) {
    assert.equal(validateAudio(new Blob(["audio"], { type })), type);
  }
  assert.equal(validateAudio(new Blob(["audio"], { type: "audio/mp4;codecs=mp4a.40.2" })), "audio/mp4");
  assert.throws(() => validateAudio(new Blob([], { type: "audio/mp4" })), /vide/);
  assert.throws(() => validateAudio(new Blob(["audio"], { type: "text/html" })), /Format audio/);
  assert.equal(validateAudio(new Blob([new Uint8Array(MAX_AUDIO_BYTES)], { type: "audio/webm" })), "audio/webm");
  assert.throws(() => validateAudio(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/webm" })), /25 Mio/);
});

test("audio : métadonnées uniques et conservation lors de la mise à jour des réglages", () => {
  const blob = new Blob(["audio"], { type: "audio/webm;codecs=opus" });
  const audio = audioAttachment(blob, "Prise.webm", 3.5);
  assert.equal(audio.mimeType, "audio/webm");
  assert.equal(audio.durationSeconds, 3.5);
  assert.notEqual(audioAttachment(blob, "Prise.webm", 3.5).id, audio.id);
  const original = { id: crypto.randomUUID(), name: "Basse", values: {}, notes: "", createdAt: audio.createdAt, updatedAt: audio.createdAt, audio };
  assert.deepEqual(prepareThemePreset("Basse", { frequency: 20 }, "", original).audio, audio);
  assert.equal(prepareThemePreset("Variante", { frequency: 20 }, "", original).audio, undefined);
  assert.deepEqual(original.audio, audio);
});
