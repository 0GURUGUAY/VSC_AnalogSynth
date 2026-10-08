import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { clearCloudMediaSession, configureCloudMediaSession, configureCloudWorkspaceMediaSession, deleteLocalData, saveMedia, loadMedia, deleteMedia } from "../src/storage.ts";
import { MAX_MIDI_BYTES, validateMidiBytes } from "../src/midi.ts";

const midi = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 4, 0, 255, 47, 0]);
test("MIDI : fichier standard, en-tête, pistes, troncature et limite exacte", () => {
  validateMidiBytes(midi);
  assert.throws(() => validateMidiBytes(new Uint8Array(14)), /standard/);
  assert.throws(() => validateMidiBytes(midi.subarray(0, 25)), /tronqué/);
  const wrongFormat = midi.slice();
  wrongFormat[9] = 3;
  assert.throws(() => validateMidiBytes(wrongFormat), /en-tête/);
  const extra = new Uint8Array(27);
  extra.set(midi);
  assert.throws(() => validateMidiBytes(extra), /supplémentaires/);
  const atLimit = new Uint8Array(MAX_MIDI_BYTES);
  atLimit.set(midi);
  new DataView(atLimit.buffer).setUint32(18, MAX_MIDI_BYTES - 22);
  validateMidiBytes(atLimit);
  assert.throws(() => validateMidiBytes(new Uint8Array(MAX_MIDI_BYTES + 1)), /10 Mio/);
});

test("stockage cloud uniquement : IndexedDB supprimée, médias gardés en mémoire ou relus du cloud", async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open("analog-memory", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => {
      const transaction = request.result.transaction("workspace", "readwrite");
      transaction.objectStore("workspace").put({ name: "Mon thème 01" }, "current");
      transaction.oncomplete = () => {
        request.result.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
  await deleteLocalData();
  const recreated = await new Promise((resolve, reject) => {
    const request = indexedDB.open("analog-memory", 1);
    request.onsuccess = () => {
      const database = request.result;
      const objectStoreCount = database.objectStoreNames.length;
      database.close();
      resolve(objectStoreCount);
    };
    request.onerror = () => reject(request.error);
  });
  assert.equal(recreated, 0);
  await deleteLocalData();

  const fileId = crypto.randomUUID();
  await saveMedia(fileId, new Blob([midi], { type: "audio/midi" }));
  assert.deepEqual(new Uint8Array(await (await loadMedia(fileId)).arrayBuffer()), midi);
  await deleteMedia([fileId]);
  await assert.rejects(loadMedia(fileId), /Connecte-toi/);

  const remoteId = crypto.randomUUID();
  let requestedId = "";
  configureCloudMediaSession(async (id) => {
    requestedId = id;
    return new Blob([midi], { type: "audio/midi" });
  });
  assert.deepEqual(new Uint8Array(await (await loadMedia(remoteId)).arrayBuffer()), midi);
  assert.equal(requestedId, remoteId);
  clearCloudMediaSession();
  await assert.rejects(loadMedia(remoteId), /Connecte-toi/);
});

test("photos des modules : routage actualisé après ajout, remplacement et changement de thème", async () => {
  let workspace = { module: { facades: [] } };
  const requests = [];
  const configure = (themeId) => configureCloudWorkspaceMediaSession(
    () => workspace,
    async (id) => {
      requests.push(["theme", themeId, id]);
      return new Blob(["theme"]);
    },
    async (moduleId, id) => {
      requests.push(["module", moduleId, id]);
      return new Blob(["module"]);
    },
  );
  configure("new-theme");
  workspace = { module: { facades: [{ moduleId: "rings", photoId: "rings-photo" }] } };
  assert.equal(await (await loadMedia("rings-photo")).text(), "module");
  assert.equal(await (await loadMedia("recording")).text(), "theme");
  workspace = { module: { facades: [
    { moduleId: "rings", photoId: "updated-photo" },
    { moduleId: "plaits", photoId: "plaits-photo" },
    { photoId: "legacy-photo" },
  ] } };
  await loadMedia("updated-photo");
  await loadMedia("plaits-photo");
  await loadMedia("legacy-photo");
  configure("opened-theme");
  await loadMedia("updated-photo");
  await loadMedia("recording");
  assert.deepEqual(requests, [
    ["module", "rings", "rings-photo"],
    ["theme", "new-theme", "recording"],
    ["module", "rings", "updated-photo"],
    ["module", "plaits", "plaits-photo"],
    ["theme", "new-theme", "legacy-photo"],
    ["module", "rings", "updated-photo"],
    ["theme", "opened-theme", "recording"],
  ]);
  clearCloudMediaSession();
});

test("une erreur de photo cloud est propagée et permet une nouvelle tentative", async () => {
  configureCloudWorkspaceMediaSession(
    () => ({ module: { facades: [{ moduleId: "rings", photoId: "failed-photo" }] } }),
    async () => { throw new Error("Mauvais chemin de média"); },
    async () => { throw new Error("Photo inaccessible"); },
  );
  await assert.rejects(loadMedia("failed-photo"), /Photo inaccessible/);
  configureCloudWorkspaceMediaSession(
    () => ({ module: { facades: [{ moduleId: "rings", photoId: "failed-photo" }] } }),
    async () => { throw new Error("Mauvais chemin de média"); },
    async () => new Blob(["photo"]),
  );
  assert.equal(await (await loadMedia("failed-photo")).text(), "photo");
  clearCloudMediaSession();
});
