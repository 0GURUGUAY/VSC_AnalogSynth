import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createApp } from "../server/app.ts";
import { workspaceSchema, modulePresetSchema, checkDocumentSize, ApiError } from "../server/schema.ts";
import { MAX_AUDIO_BYTES } from "../src/audio.ts";
import { createCloudStore } from "../server/store.ts";
import { prepareModuleForPhoto } from "../src/library.ts";
import { migrateSet } from "../src/sets.ts";

const themeId = "12345678-1234-4234-8234-123456789012";
const facadeId = "22345678-1234-4234-8234-123456789012";
const mediaId = "32345678-1234-4234-8234-123456789012";
const moduleId = "42345678-1234-4234-8234-123456789012";
const presetId = "52345678-1234-4234-8234-123456789012";
function libraryModule() {
  const now = "2026-10-07T12:00:00.000Z";
  return {
    id: moduleId, name: "Rings", manufacturer: "Mutable Instruments", model: "Rings",
    controls: [{ id: "frequency", label: "Frequency", kind: "knob" }],
    jacks: [{ id: "out", label: "OUT", direction: "output" }],
    createdAt: now, updatedAt: now,
  };
}
function modulePreset() {
  const now = "2026-10-07T12:00:00.000Z";
  return { id: presetId, name: "Cloche", values: { frequency: 72 }, notes: "Doux", createdAt: now, updatedAt: now };
}

test("l'ajout d'une photo prépare un nom provisoire sans modifier le brouillon", () => {
  for (const name of ["", "   ", "\t\n"]) {
    const draft = { ...libraryModule(), name };
    const prepared = prepareModuleForPhoto(draft);
    assert.deepEqual(prepared, { ...draft, name: "Nouveau module" });
    assert.equal(draft.name, name);
  }
  assert.deepEqual(prepareModuleForPhoto(libraryModule()), libraryModule());
  assert.equal(prepareModuleForPhoto({ ...libraryModule(), name: "  Rings  " }).name, "Rings");
});
function workspace() {
  return {
    version: 2, set: { id: themeId, name: "Thème", bpm: 90, key: "E majeur", artist: "Artiste", abletonTrack: "Rings" },
    module: { name: "Rings", manufacturer: "Mutable Instruments", activeFacadeId: facadeId,
      facades: [{ id: facadeId, name: "Façade", createdAt: "2026-10-07T12:00:00.000Z", values: { frequency: 50 }, model: "", notes: "", cables: [], recordings: [] }],
    },
  };
}

test("le contrat conserve les métadonnées et refuse les références incohérentes", () => {
  assert.deepEqual(workspaceSchema.parse(workspace()), workspace());
  const empty = workspace();
  empty.module.facades = [];
  empty.module.activeFacadeId = "";
  assert.deepEqual(workspaceSchema.parse(empty), empty);
  const withMidiChannel = workspace();
  withMidiChannel.module.facades[0].midiChannel = 16;
  const migrated = workspaceSchema.parse(withMidiChannel);
  assert.equal(migrated.module.facades[0].midiChannel, undefined);
  assert.deepEqual(migrated.module.facades[0].cables, []);
  withMidiChannel.module.facades[0].midiChannel = 17;
  assert.equal(workspaceSchema.safeParse(withMidiChannel).success, false);
  const duplicate = workspace();
  duplicate.module.facades.push(duplicate.module.facades[0]);
  assert.equal(workspaceSchema.safeParse(duplicate).success, false);
  const missing = workspace();
  missing.module.activeFacadeId = mediaId;
  assert.equal(workspaceSchema.safeParse(missing).success, false);
  const invalid = workspace();
  invalid.module.facades[0].values.frequency = 101;
  assert.equal(workspaceSchema.safeParse(invalid).success, false);
  assert.equal(workspaceSchema.safeParse({ ...workspace(), ownerId: "someone-else" }).success, false);
});

test("les limites documentaires sont mesurées en octets UTF-8", () => {
  checkDocumentSize({ text: "a".repeat(799989) });
  assert.throws(() => checkDocumentSize({ text: "é".repeat(400000) }), { status: 413 });
});

test("API : authentification, isolation, validation, conflits et fichiers", async (t) => {
  const calls = [];
  const store = {
    async readGeminiApiKey() { return null; },
    async list(userId) { calls.push(userId); return []; },
    async listModules(userId) { calls.push(["modules", userId]); return []; },
    async writeModule(userId, value) { calls.push(["module", userId, value.id]); return value; },
    async listPresets(userId, id) { calls.push(["presets", userId, id]); return []; },
    async writePreset(userId, id, value) { calls.push(["preset", userId, id, value.id]); return value; },
    async writePresetAudio(userId, id, presetId, audio) {
      calls.push(["preset-audio", userId, id, presetId, audio]);
      return { ...modulePreset(), ...(audio ? { audio } : {}) };
    },
    async putModuleMedia(userId, id, fileId, bytes, mimeType) { calls.push({ userId, id, fileId, size: bytes.length, mimeType }); },
    async getModuleMedia() { return { bytes: Buffer.from("photo"), mimeType: "image/jpeg" }; },
    async read(userId, id) {
      calls.push([userId, id]);
      if (userId !== "user-a") throw new ApiError(404, "Thème introuvable.");
      return { workspace: workspace(), revision: 1 };
    },
    async write(userId, value, revision) {
      calls.push([userId, value.set.id]);
      if (revision === 3) throw new ApiError(409, "Conflit");
      return { workspace: value, revision: revision + 1 };
    },
    async putMedia(userId, id, fileId, bytes, mimeType) { calls.push({ userId, id, fileId, size: bytes.length, mimeType }); },
    async getMedia() { return { bytes: Buffer.from("test"), mimeType: "audio/webm" }; },
  };
  const app = createApp({
    store, allowedOrigins: ["https://app.example"], geminiApiKey: "",
    async verifyToken(token) {
      if (token !== "user-a" && token !== "user-b") throw new Error("Invalid token");
      return { sub: token };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (url, { token = "user-a", headers = {}, ...options } = {}) => fetch(base + url, {
    ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
  assert.equal((await send("/api/health", { token: "" })).status, 200);
  assert.equal((await send("/api/themes", { token: "" })).status, 401);
  assert.equal((await send("/api/modules")).status, 200);
  const moduleWrite = await send(`/api/modules/${moduleId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(libraryModule()),
  });
  assert.equal(moduleWrite.status, 200);
  assert.equal((await moduleWrite.json()).module.name, "Rings");
  const unnamed = { ...libraryModule(), name: "" };
  const writeModule = (value) => send(`/api/modules/${moduleId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  assert.equal((await writeModule(unnamed)).status, 400);
  const photoModule = await writeModule(prepareModuleForPhoto(unnamed));
  assert.equal(photoModule.status, 200);
  assert.equal((await photoModule.json()).module.name, "Nouveau module");
  const updatedPhotoModule = await writeModule({
    ...prepareModuleForPhoto(unnamed), photoId: mediaId,
  });
  assert.equal(updatedPhotoModule.status, 200);
  assert.equal((await updatedPhotoModule.json()).module.photoId, mediaId);
  assert.equal((await writeModule({ ...unnamed, name: "Rings" })).status, 200);
  const presetWrite = await send(`/api/modules/${moduleId}/presets/${presetId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modulePreset()),
  });
  assert.equal(presetWrite.status, 200);
  assert.equal((await presetWrite.json()).preset.name, "Cloche");
  const modulePhoto = await send(`/api/modules/${moduleId}/media/${mediaId}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Media-Type": "image/jpeg" }, body: Buffer.from("photo"),
  });
  assert.equal(modulePhoto.status, 201);
  const audioMetadata = { id: mediaId, name: "Prise.webm", mimeType: "audio/webm", durationSeconds: 4, createdAt: modulePreset().createdAt };
  const attachSound = await send(`/api/modules/${moduleId}/presets/${presetId}/audio`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: audioMetadata }),
  });
  assert.equal(attachSound.status, 200);
  assert.deepEqual((await attachSound.json()).preset.audio, audioMetadata);
  assert.deepEqual(calls.at(-1), ["preset-audio", "user-a", moduleId, presetId, audioMetadata]);
  const removeSound = await send(`/api/modules/${moduleId}/presets/${presetId}/audio`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: null }),
  });
  assert.equal(removeSound.status, 200);
  assert.equal("audio" in (await removeSound.json()).preset, false);
  const invalidSound = await send(`/api/modules/${moduleId}/presets/${presetId}/audio`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: { ...audioMetadata, mimeType: "image/jpeg" } }),
  });
  assert.equal(invalidSound.status, 400);
  const uploadModuleMedia = (type, bytes) => send(`/api/modules/${moduleId}/media/${mediaId}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Media-Type": type }, body: bytes,
  });
  assert.equal((await uploadModuleMedia("audio/webm;codecs=opus", Buffer.from("audio"))).status, 201);
  assert.equal(calls.at(-1).mimeType, "audio/webm");
  assert.equal((await uploadModuleMedia("audio/mp4", Buffer.from("audio"))).status, 201);
  assert.equal((await uploadModuleMedia("audio/mp4", Buffer.alloc(MAX_AUDIO_BYTES))).status, 201);
  assert.equal((await uploadModuleMedia("audio/mp4", Buffer.alloc(MAX_AUDIO_BYTES + 1))).status, 413);
  assert.equal((await uploadModuleMedia("image/jpeg", Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await uploadModuleMedia("audio/webm", Buffer.alloc(0))).status, 400);
  assert.equal((await uploadModuleMedia("text/html", Buffer.from("invalid"))).status, 400);
  assert.equal((await send("/api/themes", { token: "invalid" })).status, 401);
  assert.equal((await send("/api/themes", { headers: { Origin: "https://evil.example" } })).status, 403);
  const preflight = await send("/api/themes", { method: "OPTIONS", token: "", headers: { Origin: "https://app.example" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal((await send("/api/themes")).status, 200);
  assert.equal(calls.at(-1), "user-a");
  assert.equal((await send(`/api/themes/${themeId}`, { token: "user-b" })).status, 404);
  assert.deepEqual(calls.at(-1), ["user-b", themeId]);
  const write = (url, revision, value = workspace(), method = "PUT") => send(url, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: value, revision }),
  });
  const created = await write("/api/themes", 0, workspace(), "POST");
  assert.equal(created.status, 201);
  assert.equal((await created.json()).revision, 1);
  assert.equal((await write(`/api/themes/${themeId}`, 1)).status, 200);
  const routed = workspace();
  routed.set.masterClockFacadeId = facadeId;
  routed.module.facades[0].cables = [
    { id: crypto.randomUUID(), source: "Midihub OUT MIDI A", destination: "Rings IN MIDI", color: "blue", midiChannel: 1, carriesClock: true },
    { id: crypto.randomUUID(), source: "Midihub OUT MIDI B", destination: "Rings IN USB", color: "green", midiChannel: 16, carriesClock: false },
  ];
  const routedResponse = await write(`/api/themes/${themeId}`, 1, routed);
  assert.equal(routedResponse.status, 200);
  assert.deepEqual((await routedResponse.json()).workspace, routed);
  assert.equal((await write(`/api/themes/${themeId}`, 3)).status, 409);
  assert.equal((await write(`/api/themes/${mediaId}`, 1)).status, 400);
  assert.equal((await write(`/api/themes/${themeId}`, 0)).status, 400);
  assert.equal((await write("/api/themes", 0, { ...workspace(), version: 1 }, "POST")).status, 400);
  assert.equal((await send("/api/themes/../../invalid")).status, 404);
  assert.equal((await send("/api/themes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  const upload = await send(`/api/themes/${themeId}/media/${mediaId}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Media-Type": "audio/midi" }, body: Buffer.from("invalid"),
  });
  assert.equal(upload.status, 400);
  const audio = await send(`/api/themes/${themeId}/media/${mediaId}`, {
    method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Media-Type": "audio/webm" }, body: Buffer.from("test"),
  });
  assert.equal(audio.status, 201);
  assert.equal(calls.at(-1).userId, "user-a");
  const downloaded = await send(`/api/themes/${themeId}/media/${mediaId}`);
  assert.equal(await downloaded.text(), "test");
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await send("/api/rings/analyze", { method: "POST" })).status, 503);
});

function fakeServices() {
  const documents = new Map();
  const objects = new Map();
  function ref(path, order, maximum) {
    return {
      path,
      doc: (id) => ref(`${path}/${id}`),
      collection: (name) => ref(`${path}/${name}`),
      orderBy: (field, direction) => ref(path, { field, direction }, maximum),
      limit: (count) => ref(path, order, count),
      async get() {
        const result = snapshot(this);
        if (result.docs) {
          if (order) result.docs.sort((a, b) => String(a.data()[order.field]).localeCompare(String(b.data()[order.field])) * (order.direction === "desc" ? -1 : 1));
          if (maximum !== undefined) result.docs = result.docs.slice(0, maximum);
        }
        return result;
      },
      async create(data) {
        if (documents.has(path)) throw new Error("already exists");
        documents.set(path, structuredClone(data));
      },
      async set(data) { documents.set(path, structuredClone(data)); },
    };
  }

  function snapshot(reference) {
    if (reference.path.split("/").length % 2) {
      const prefix = reference.path + "/";
      return { docs: [...documents.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/")).map((key) => snapshot(ref(key))) };
    }
    return { id: reference.path.split("/").at(-1), ref: reference, exists: documents.has(reference.path), data: () => documents.get(reference.path) };
  }
  return {
    documents, objects,
    db: {
      collection: (name) => ref(name),
      async runTransaction(callback) {
        const changes = [];
        const result = await callback({
          async get(reference) { return snapshot(reference); },
          set(reference, data) { changes.push(() => documents.set(reference.path, structuredClone(data))); },
          delete(reference) { changes.push(() => documents.delete(reference.path)); },
        });
        changes.forEach((change) => change());
        return result;
      },
    },
    bucket: {
      file(path) {
        return {
          async save(bytes, options) {
            assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
            if (objects.has(path)) throw Object.assign(new Error("already exists"), { code: 412 });
            objects.set(path, Buffer.from(bytes));
          },
          async delete() { objects.delete(path); },
          async download() { return [objects.get(path)]; },
        };
      },
    },
  };
}

test("Gemini : configuration privée, clé jamais renvoyée, priorité personnelle sur les deux analyses", async (t) => {
    const services = fakeServices();
    const store = createCloudStore("test", services);
    const app = createApp({
      store, allowedOrigins: ["https://app.example"], geminiApiKey: "test-server-key",
      async verifyToken(token) {
        if (!["user-a", "user-b"].includes(token)) throw new Error("Invalid token");
        return { sub: token };
      },
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const originalFetch = globalThis.fetch;
    const geminiKeys = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
        geminiKeys.push(options.headers["x-goog-api-key"]);
        return new Response(JSON.stringify({ error: "quota" }), { status: 429 });
      }
      return originalFetch(url, options);
    };
    t.after(() => { globalThis.fetch = originalFetch; });
    const send = (path, { token = "user-a", ...options } = {}) => originalFetch(base + path, {
      ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const put = (apiKey, token = "user-a") => send("/api/settings/gemini", {
      token, method: "PUT", body: JSON.stringify({ apiKey }),
    });
    assert.equal((await send("/api/settings/gemini", { token: "" })).status, 401);
    assert.equal((await put("test-gemini-personal-key-a", "")).status, 401);
    assert.deepEqual(await (await send("/api/settings/gemini")).json(), { configured: false, serverAvailable: true });
    for (const value of ["", "short", "bad key with whitespace", 123, "a".repeat(201)]) {
      assert.equal((await put(value)).status, 400);
    }
    const saved = await put("  test-gemini-personal-key-a  ");
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { configured: true, serverAvailable: true });
    assert.equal(await store.readGeminiApiKey("user-a"), "test-gemini-personal-key-a");
    const status = await send("/api/settings/gemini");
    assert.equal(status.headers.get("cache-control"), "no-store");
    assert.deepEqual(await status.json(), { configured: true, serverAvailable: true });
    assert.deepEqual(await (await send("/api/settings/gemini", { token: "user-b" })).json(), { configured: false, serverAvailable: true });
    const analyze = (hidden, token = "user-a") => send(hidden ? "/api/rings/hidden-jacks" : "/api/rings/analyze", {
      token, method: "POST", body: JSON.stringify(hidden
        ? { name: "Test", visibleJacks: [] } : { mimeType: "image/png", imageBase64: "cGhvdG8=" }),
    });
    for (const hidden of [false, true]) {
      assert.equal((await analyze(hidden)).status, 429);
      assert.equal(geminiKeys.at(-1), "test-gemini-personal-key-a");
    }
    assert.equal((await analyze(false, "user-b")).status, 429);
    assert.equal(geminiKeys.at(-1), "test-server-key");
    assert.equal((await put("test-gemini-replacement-key")).status, 200);
    assert.equal(await store.readGeminiApiKey("user-a"), "test-gemini-replacement-key");
    const removed = await put(null);
    assert.deepEqual(await removed.json(), { configured: false, serverAvailable: true });
    assert.equal(await store.readGeminiApiKey("user-a"), null);
    assert.equal((await analyze(true)).status, 429);
    assert.equal(geminiKeys.at(-1), "test-server-key");
    assert.equal(services.documents.get("users/user-a/settings/ai").geminiApiKey, null);
    assert.equal(services.documents.has("users/user-b/settings/ai"), false);
  });

test("son de preset : ancien format, association privée, remplacement et suppression sans toucher aux réglages", async () => {
  assert.deepEqual(modulePresetSchema.parse(modulePreset()), modulePreset());
  const services = fakeServices();
  const store = createCloudStore("test", services);
  await store.writeModule("user-a", libraryModule());
  await store.writePreset("user-a", moduleId, modulePreset());
  const audio = { id: mediaId, name: "prise.webm", mimeType: "audio/webm", durationSeconds: 3.5, createdAt: modulePreset().createdAt };
  await assert.rejects(store.writePresetAudio("user-a", moduleId, presetId, audio), { status: 400 });
  await assert.rejects(store.writePreset("user-a", moduleId, { ...modulePreset(), audio }), { status: 400 });
  await store.putModuleMedia("user-a", moduleId, mediaId, Buffer.from("audio"), audio.mimeType);
  const linked = await store.writePresetAudio("user-a", moduleId, presetId, audio);
  assert.deepEqual(linked.audio, audio);
  assert.deepEqual(linked.values, modulePreset().values);
  assert.equal(linked.notes, modulePreset().notes);
  assert.equal(linked.createdAt, modulePreset().createdAt);
  assert.deepEqual((await store.getModuleMedia("user-a", moduleId, mediaId)).bytes, Buffer.from("audio"));
  await assert.rejects(store.getModuleMedia("user-b", moduleId, mediaId), { status: 404 });
  await assert.rejects(store.writePresetAudio("user-b", moduleId, presetId, audio), { status: 400 });
  const secondId = crypto.randomUUID();
  const second = { ...audio, id: secondId, name: "prise.m4a", mimeType: "audio/mp4" };
  await store.putModuleMedia("user-a", moduleId, secondId, Buffer.from("audio2"), second.mimeType);
  const renamed = { ...linked, name: "Nom récent", values: { frequency: 90 }, notes: "Notes récentes" };
  await store.writePreset("user-a", moduleId, renamed);
  const replaced = await store.writePresetAudio("user-a", moduleId, presetId, second);
  assert.deepEqual(replaced.audio, second);
  assert.equal(replaced.name, renamed.name);
  assert.deepEqual(replaced.values, renamed.values);
  assert.equal(replaced.notes, renamed.notes);
  assert.equal((await store.listPresets("user-a", moduleId)).length, 1);
  const removed = await store.writePresetAudio("user-a", moduleId, presetId, null);
  assert.equal("audio" in removed, false);
  assert.deepEqual(removed.values, renamed.values);
  await assert.rejects(store.writePresetAudio("user-a", moduleId, crypto.randomUUID(), null), { status: 404 });
});

test("Firestore : modifier un preset conserve son identifiant sans créer de doublon", async () => {
  const store = createCloudStore("test", fakeServices());
  const module = libraryModule();
  await store.writeModule("user-a", { ...module, controls: [...module.controls, { id: "level", label: "Level", kind: "slider" }] });
  const original = modulePreset();
  await store.writePreset("user-a", moduleId, original);
  const updated = {
    ...original,
    name: "Cloche modifiée",
    values: { frequency: 81, level: null },
    notes: "Notes modifiées",
    updatedAt: "2026-10-07T21:00:00.000Z",
  };
  await store.writePreset("user-a", moduleId, updated);
  assert.deepEqual(await store.listPresets("user-a", moduleId), [updated]);
  assert.equal(updated.createdAt, original.createdAt);
  await assert.rejects(store.listPresets("user-b", moduleId), { status: 404 });
});

test("Firestore : écriture transactionnelle, ordre des façades, conflit sans perte", async () => {
  const services = fakeServices();
  const store = createCloudStore("test", services);
  const original = workspace();
  await store.writeModule("user-a", libraryModule());
  await store.writePreset("user-a", moduleId, modulePreset());
  assert.deepEqual(await store.listModules("user-a"), [libraryModule()]);
  assert.deepEqual(await store.listPresets("user-a", moduleId), [modulePreset()]);
  const missingModule = workspace();
  missingModule.module.facades[0].moduleId = mediaId;
  await assert.rejects(store.write("user-a", missingModule, 0), { status: 400 });
  const missingPreset = workspace();
  missingPreset.module.facades[0].moduleId = moduleId;
  missingPreset.module.facades[0].presetId = mediaId;
  await assert.rejects(store.write("user-a", missingPreset, 0), { status: 400 });
  original.module.facades[0].moduleId = moduleId;
  original.module.facades[0].presetId = presetId;
  await store.write("user-a", original, 0);
  const resolved = (await store.read("user-a", themeId)).workspace;
  assert.deepEqual(resolved, { ...original, module: { ...original.module, facades: [{
    ...original.module.facades[0], moduleName: "Rings", controls: libraryModule().controls,
    jacks: libraryModule().jacks, model: "Rings",
  }] } });
  assert.equal(services.documents.has(`users/user-a/themes/${themeId}/moduleInstances/${facadeId}`), true);
  const storedInstance = services.documents.get(`users/user-a/themes/${themeId}/moduleInstances/${facadeId}`);
  assert.equal("controls" in storedInstance, false);
  assert.equal(storedInstance.moduleId, moduleId);
  await assert.rejects(store.read("user-b", themeId), { status: 404 });
  await assert.rejects(store.write("user-a", workspace(), 0), { status: 409 });
  const modified = workspace();
  modified.set.name = "Renommé";
  modified.module.facades.unshift({ ...modified.module.facades[0], id: mediaId, name: "Première" });
  modified.set.masterClockFacadeId = mediaId;
  modified.module.facades[1].cables = [
    { id: crypto.randomUUID(), source: "Routeur OUT MIDI A", destination: "Rings IN MIDI 1", color: "blue", midiChannel: 1, carriesClock: true },
    { id: crypto.randomUUID(), source: "Routeur OUT MIDI B", destination: "Rings IN MIDI 2", color: "green", midiChannel: 16, carriesClock: false },
  ];
  await store.write("user-a", modified, 1);
  assert.deepEqual((await store.read("user-a", themeId)).workspace, modified);
  const patchId = modified.module.facades[1].cables[0].id;
  assert.equal(services.documents.has(`users/user-a/themes/${themeId}/patches/${patchId}`), true);
  assert.equal("cables" in services.documents.get(`users/user-a/themes/${themeId}/moduleInstances/${mediaId}`), false);
  await assert.rejects(store.write("user-a", original, 1), { status: 409 });
  assert.deepEqual((await store.read("user-a", themeId)).workspace, modified);
  await store.write("user-a", original, 2);
  assert.equal(services.documents.has(`users/user-a/themes/${themeId}/moduleInstances/${mediaId}`), false);
  const legacy = workspace();
  legacy.module.facades[0].midiChannel = 8;
  legacy.module.facades[0].cables = [
    { id: crypto.randomUUID(), source: "Routeur OUT MIDI", destination: "Rings IN MIDI", color: "blue" },
  ];
  await store.write("user-a", legacy, 3);
  const migrated = (await store.read("user-a", themeId)).workspace;
  assert.equal(migrated.module.facades[0].midiChannel, undefined);
  assert.equal(migrated.module.facades[0].cables[0].midiChannel, 8);
  await store.write("user-a", migrated, 4);
  assert.equal("midiChannel" in services.documents.get(`users/user-a/themes/${themeId}/moduleInstances/${facadeId}`), false);
});

test("Cloud Storage : fichiers privés, immuables et nettoyage sur échec documentaire", async () => {
  const services = fakeServices();
  const store = createCloudStore("test", services);
  await store.writeModule("user-a", libraryModule());
  await store.putModuleMedia("user-a", moduleId, mediaId, Buffer.from("photo"), "image/jpeg");
  assert.equal((await store.getModuleMedia("user-a", moduleId, mediaId)).bytes.toString(), "photo");
  await assert.rejects(store.getModuleMedia("user-b", moduleId, mediaId), { status: 404 });
  await assert.rejects(store.putMedia("user-a", themeId, mediaId, Buffer.from("test"), "audio/webm"), { status: 404 });
  await store.write("user-a", workspace(), 0);
  await store.putMedia("user-a", themeId, mediaId, Buffer.from("test"), "audio/webm");
  const file = await store.getMedia("user-a", themeId, mediaId);
  assert.equal(file.bytes.toString(), "test");
  await assert.rejects(store.getMedia("user-b", themeId, mediaId), { status: 404 });
  await assert.rejects(store.putMedia("user-a", themeId, mediaId, Buffer.from("new"), "audio/webm"), { status: 409 });
  const orphanId = "42345678-1234-4234-8234-123456789012";
  services.documents.set(`users/user-a/themes/${themeId}/media/${orphanId}`, { mimeType: "audio/webm" });
  await assert.rejects(store.putMedia("user-a", themeId, orphanId, Buffer.from("test"), "audio/webm"));
  assert.equal(services.objects.has(`users/user-a/themes/${themeId}/media/${orphanId}`), false);
});

test("Firestore SET: migrate a theme, separate PATCHES and cables, preserve media and revisions", async () => {
  const services = fakeServices();
  const store = createCloudStore("test", services);
  const legacy = workspace();
  legacy.module.facades[0].cables.push({ id: crypto.randomUUID(), source: "Clock OUT MIDI", destination: "Rings IN MIDI", color: "blue", carriesClock: true });
  await store.write("user-a", legacy, 0);
  await store.putMedia("user-a", themeId, mediaId, Buffer.from("legacy-audio"), "audio/webm");
  const migrated = migrateSet((await store.read("user-a", themeId)).workspace);
  const patchId = crypto.randomUUID();
  migrated.patches.push({ id: patchId, name: "Basse", notes: "Setup basse", moduleInstanceIds: [] });
  await store.write("user-a", migrated, 1);
  assert.deepEqual((await store.read("user-a", themeId)).workspace, migrated);
  assert.equal(services.documents.has(`users/user-a/sets/${themeId}/patches/${patchId}`), true);
  assert.equal(services.documents.has(`users/user-a/sets/${themeId}/cables/${legacy.module.facades[0].cables[0].id}`), true);
  assert.equal(services.documents.get(`users/user-a/sets/${themeId}`).version, 3);
  assert.equal((await store.list("user-a")).length, 1);
  assert.equal((await store.getMedia("user-a", themeId, mediaId)).bytes.toString(), "legacy-audio");
  const newMedia = crypto.randomUUID();
  await store.putMedia("user-a", themeId, newMedia, Buffer.from("new-audio"), "audio/webm");
  assert.equal((await store.getMedia("user-a", themeId, newMedia)).bytes.toString(), "new-audio");
  await assert.rejects(store.read("user-b", themeId), { status: 404 });
  await assert.rejects(store.getMedia("user-b", themeId, mediaId), { status: 404 });
  await assert.rejects(store.write("user-a", migrated, 1), { status: 409 });
  await assert.rejects(store.write("user-a", legacy, 1), { status: 409 });
  migrated.patches = migrated.patches.filter((patch) => patch.id !== patchId);
  migrated.module.facades[0].cables = [];
  await store.write("user-a", migrated, 2);
  assert.equal(services.documents.has(`users/user-a/sets/${themeId}/patches/${patchId}`), false);
  assert.equal(services.documents.has(`users/user-a/sets/${themeId}/cables/${legacy.module.facades[0].cables[0].id}`), false);
  assert.deepEqual((await store.read("user-a", themeId)).workspace, migrated);
});

test("SET API: list, create, read, update and media use authenticated routes", async (t) => {
  const store = createCloudStore("test", fakeServices());
  const app = createApp({ store, allowedOrigins: [], async verifyToken(token) { return { sub: token }; } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, options = {}) => fetch(base + path, { ...options, headers: { Authorization: "Bearer user-a", ...options.headers } });
  const value = migrateSet(workspace());
  const create = await send("/api/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: value, revision: 0 }) });
  assert.equal(create.status, 201);
  assert.deepEqual((await create.json()).workspace, value);
  assert.equal((await (await send("/api/sets")).json()).sets.length, 1);
  assert.deepEqual((await (await send(`/api/sets/${themeId}`)).json()).workspace, value);
  const update = await send(`/api/sets/${themeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: value, revision: 1 }) });
  assert.equal(update.status, 200);
  assert.equal((await send(`/api/sets/${themeId}/media/${mediaId}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Media-Type": "audio/webm" }, body: Buffer.from("sound") })).status, 201);
  assert.equal(await (await send(`/api/sets/${themeId}/media/${mediaId}`)).text(), "sound");
});
