import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ApiError, checkDocumentSize, libraryModuleSchema, modulePresetSchema, workspaceSchema } from "./schema";
import type { AudioAttachment, LibraryModule, ModulePreset, Workspace } from "../src/types";

export type ThemeRecord = { workspace: Workspace; revision: number; updatedAt: string };
export interface CloudStore {
  readGeminiApiKey(userId: string): Promise<string | null>;
  writeGeminiApiKey(userId: string, apiKey: string | null): Promise<void>;
  list(userId: string): Promise<unknown[]>;
  read(userId: string, themeId: string): Promise<ThemeRecord>;
  write(userId: string, workspace: Workspace, revision: number): Promise<ThemeRecord>;
  listModules(userId: string): Promise<LibraryModule[]>;
  writeModule(userId: string, module: LibraryModule): Promise<LibraryModule>;
  listPresets(userId: string, moduleId: string): Promise<ModulePreset[]>;
  writePreset(userId: string, moduleId: string, preset: ModulePreset): Promise<ModulePreset>;
  writePresetAudio(userId: string, moduleId: string, presetId: string, audio: AudioAttachment | null): Promise<ModulePreset>;
  putModuleMedia(userId: string, moduleId: string, mediaId: string, bytes: Buffer, mimeType: string): Promise<void>;
  getModuleMedia(userId: string, moduleId: string, mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
  putMedia(userId: string, themeId: string, mediaId: string, bytes: Buffer, mimeType: string): Promise<void>;
  getMedia(userId: string, themeId: string, mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
}

type Services = {
  db: ReturnType<typeof getFirestore>;
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
};

export function createCloudStore(bucketName: string, services?: Services): CloudStore {
  const db = services?.db ?? getFirestore();
  const bucket = services?.bucket ?? getStorage().bucket(bucketName);
  const theme = (userId: string, id: string) => db.collection("users").doc(userId).collection("themes").doc(id);
  const setRef = (userId: string, id: string) => db.collection("users").doc(userId).collection("sets").doc(id);
  const moduleRef = (userId: string, id: string) => db.collection("users").doc(userId).collection("modules").doc(id);
  const objectPath = (userId: string, themeId: string, mediaId: string) => `users/${userId}/themes/${themeId}/media/${mediaId}`;
  const moduleObjectPath = (userId: string, moduleId: string, mediaId: string) => `users/${userId}/modules/${moduleId}/media/${mediaId}`;
  async function recordRef(userId: string, id: string) {
    const ref = setRef(userId, id);
    return (await ref.get()).exists ? ref : theme(userId, id);
  }
  async function checkPresetAudio(userId: string, moduleId: string, audio: AudioAttachment | null | undefined) {
    if (!audio) return;
    const metadata = await moduleRef(userId, moduleId).collection("media").doc(audio.id).get();
    if (!metadata.exists || metadata.data()!.mimeType !== audio.mimeType) {
      throw new ApiError(400, "Le son doit être téléversé dans ce module avant d'être associé au preset.");
    }
  }
  return {
    async readGeminiApiKey(userId) {
      const document = await db.collection("users").doc(userId).collection("settings").doc("ai").get();
      const key: unknown = document.data()?.geminiApiKey;
      if (key === undefined || key === null) return null;
      if (typeof key !== "string") throw new ApiError(500, "Configuration Gemini illisible.");
      return key;
    },
    async writeGeminiApiKey(userId, apiKey) {
      await db.collection("users").doc(userId).collection("settings").doc("ai").set({
        geminiApiKey: apiKey, updatedAt: new Date().toISOString(),
      });
    },
    async list(userId) {
      const [legacy, sets] = await Promise.all(["themes", "sets"].map((collection) =>
        db.collection("users").doc(userId).collection(collection).orderBy("updatedAt", "desc").limit(100).get()));
      const records = new Map([...legacy.docs, ...sets.docs].map((doc) => [doc.id, { ...doc.data(), id: doc.id, updatedAt: String(doc.data().updatedAt) }]));
      return [...records.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 100);
    },
    async read(userId, themeId) {
      return db.runTransaction(async (tx) => {
        let ref = setRef(userId, themeId);
        let document = await tx.get(ref);
        if (!document.exists) {
          ref = theme(userId, themeId);
          document = await tx.get(ref);
        }
        if (!document.exists) throw new ApiError(404, "Thème introuvable.");
        const data = document.data()!;
        const legacy = !Array.isArray(data.moduleInstanceIds);
        const instanceCollection = ref.collection(legacy ? "facades" : "moduleInstances");
        const instances = await tx.get(instanceCollection);
        const patches = legacy ? { docs: [] } : await tx.get(ref.collection(data.version === 3 ? "cables" : "patches"));
        const groups = data.version === 3 ? await tx.get(ref.collection("patches")) : undefined;
        const byId = new Map(instances.docs.map((doc) => [doc.id, doc.data()]));
        const linkedModuleIds = [...new Set(instances.docs.map((doc) => doc.data().moduleId).filter((id): id is string => typeof id === "string"))];
        const linkedModules = await Promise.all(linkedModuleIds.map((id) => tx.get(moduleRef(userId, id))));
        const moduleById = new Map(linkedModules.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data()]));
        const cablesByInstance = new Map<string, unknown[]>();
        patches.docs.forEach((doc) => {
          const data = doc.data();
          const instanceId = typeof data.moduleInstanceId === "string" ? data.moduleInstanceId : data.facadeId;
          if (typeof instanceId !== "string") return;
          const { facadeId: _facadeId, moduleInstanceId: _moduleInstanceId, ...cable } = data;
          cablesByInstance.set(instanceId, [...(cablesByInstance.get(instanceId) ?? []), cable]);
        });
        const instanceIds: string[] = legacy ? data.facadeIds : data.moduleInstanceIds;
        const workspace = workspaceSchema.parse({
          version: data.version ?? 2, set: data.set,
          ...(data.version === 3 ? {
            patches: data.patchIds.map((id: string) => groups?.docs.find((doc) => doc.id === id)?.data()),
            activePatchId: data.activePatchId,
          } : {}),
          module: {
            ...data.module,
            facades: instanceIds.map((id: string) => {
              const instance = byId.get(id);
              if (!instance) return undefined;
              const { cables: legacyCables, ...instanceData } = instance;
              const facade = { ...instanceData, cables: cablesByInstance.get(id) ?? legacyCables ?? [] };
              if (typeof instance.moduleId !== "string") return facade;
              const definition = moduleById.get(instance.moduleId);
              if (!definition) throw new ApiError(409, `Le module « ${instance.moduleId} » référencé par ce thème n'existe plus.`);
              return {
                ...facade,
                moduleName: definition.name,
                controls: definition.controls,
                jacks: definition.jacks,
                ...(typeof definition.photoId === "string" ? { photoId: definition.photoId } : {}),
                model: definition.model,
                moduleId: instance.moduleId,
              };
            }),
          },
        });
        return { workspace, revision: data.revision, updatedAt: data.updatedAt };
      });
    },
    async write(userId, workspace, revision) {
      const { facades, ...module } = workspace.module;
      facades.forEach(checkDocumentSize);
      const updatedAt = new Date().toISOString();
      const moduleIds = [...new Set(facades.map((facade) => facade.moduleId).filter((id): id is string => Boolean(id)))];
      const patches = facades.flatMap((facade) => facade.cables.map((cable) => ({ ...cable, facadeId: facade.id })));
      if (new Set(patches.map((cable) => cable.id)).size !== patches.length) throw new ApiError(400, "Chaque câble doit avoir un identifiant unique.");
      const definitions = await Promise.all(moduleIds.map(async (id) => {
        const document = await moduleRef(userId, id).get();
        if (!document.exists) throw new ApiError(400, `Le module « ${id} » n'existe pas dans votre bibliothèque.`);
        return [id, document.data()] as const;
      }));
      const definitionsById = new Map(definitions);
      await Promise.all(facades.filter((facade) => facade.moduleId && facade.presetId).map(async (facade) => {
        const preset = await moduleRef(userId, facade.moduleId!).collection("presets").doc(facade.presetId!).get();
        if (!preset.exists) throw new ApiError(400, `Le preset « ${facade.presetId} » n'existe pas pour ce module.`);
      }));
      const facadeInstances = facades.map((facade) => {
        const { cables: _cables, ...instance } = facade;
        if (!facade.moduleId) return instance;
        const { controls: _controls, jacks: _jacks, photoId: _photoId, moduleName: _moduleName, model: _model, ...linkedInstance } = instance;
        return linkedInstance;
      });
      const next = {
        version: workspace.version,
        set: workspace.set, module, moduleIds,
        moduleInstanceIds: facades.map((facade) => facade.id),
        patchIds: workspace.version === 3 ? workspace.patches!.map((patch) => patch.id) : patches.map((cable) => cable.id),
        ...(workspace.version === 3 ? { activePatchId: workspace.activePatchId, cableIds: patches.map((cable) => cable.id) } : {}),
        revision: revision + 1, updatedAt,
      };
      checkDocumentSize(next);
      await db.runTransaction(async (tx) => {
        const ref = workspace.version === 3 ? setRef(userId, workspace.set.id) : theme(userId, workspace.set.id);
        const document = await tx.get(ref);
        const legacyDocument = workspace.version === 3 ? await tx.get(theme(userId, workspace.set.id)) : document;
        if (workspace.version === 2 && (await tx.get(setRef(userId, workspace.set.id))).exists) {
          throw new ApiError(409, "Ce thème a été migré en SET. Mets à jour l'application avant de le modifier.");
        }
        const existing = document.exists ? document : legacyDocument;
        if ((existing.exists ? existing.data()!.revision : 0) !== revision) {
          throw new ApiError(409, "Le morceau a changé sur un autre appareil. Recharge-le avant de sauvegarder.");
        }
        if (!existing.exists && revision !== 0) throw new ApiError(404, "SET introuvable.");
        const previous = await tx.get(ref.collection("moduleInstances"));
        const cableCollection = workspace.version === 3 ? "cables" : "patches";
        const previousPatches = await tx.get(ref.collection(cableCollection));
        const previousGroups = workspace.version === 3 ? await tx.get(ref.collection("patches")) : undefined;
        const previousLegacy = await tx.get(ref.collection("facades"));
        tx.set(ref, { ...next, createdAt: existing.data()?.createdAt ?? updatedAt });
        if (workspace.version === 3) {
          const groupIds = new Set(workspace.patches!.map((patch) => patch.id));
          previousGroups?.docs.filter((doc) => !groupIds.has(doc.id)).forEach((doc) => tx.delete(doc.ref));
          workspace.patches!.forEach((patch) => tx.set(ref.collection("patches").doc(patch.id), patch));
        }
        const ids = new Set(facades.map((facade) => facade.id));
        previous.docs.filter((doc) => !ids.has(doc.id)).forEach((doc) => tx.delete(doc.ref));
        previousLegacy.docs.forEach((doc) => tx.delete(doc.ref));
        facadeInstances.forEach((facade) => {
          if (facade.moduleId && !definitionsById.has(facade.moduleId)) throw new ApiError(400, "Référence de module invalide.");
          tx.set(ref.collection("moduleInstances").doc(facade.id), facade);
        });
        const patchIds = new Set(patches.map((cable) => cable.id));
        previousPatches.docs.filter((doc) => !patchIds.has(doc.id)).forEach((doc) => tx.delete(doc.ref));
        patches.forEach(({ facadeId, ...cable }) => tx.set(ref.collection(cableCollection).doc(cable.id), { ...cable, moduleInstanceId: facadeId }));
      });
      return { workspace, revision: revision + 1, updatedAt };
    },
    async listModules(userId) {
      const result = await db.collection("users").doc(userId).collection("modules").get();
      return result.docs.map((doc) => libraryModuleSchema.parse({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async writeModule(userId, value) {
      const parsed = libraryModuleSchema.parse(value);
      checkDocumentSize(parsed);
      const ref = moduleRef(userId, parsed.id);
      await ref.set(parsed);
      return parsed;
    },
    async listPresets(userId, moduleId) {
      const ref = moduleRef(userId, moduleId);
      if (!(await ref.get()).exists) throw new ApiError(404, "Module introuvable.");
      const result = await ref.collection("presets").get();
      return result.docs.map((doc) => modulePresetSchema.parse({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async writePreset(userId, moduleId, value) {
      const preset = modulePresetSchema.parse(value);
      checkDocumentSize(preset);
      const parent = moduleRef(userId, moduleId);
      const moduleDocument = await parent.get();
      if (!moduleDocument.exists) throw new ApiError(404, "Module introuvable.");
      const knownControls = new Set((moduleDocument.data()!.controls as { id: string }[]).map((control) => control.id));
      if (Object.keys(preset.values).some((id) => !knownControls.has(id))) throw new ApiError(400, "Le preset contient un contrôle absent du module.");
      await checkPresetAudio(userId, moduleId, preset.audio);
      await parent.collection("presets").doc(preset.id).set(preset);
      return preset;
    },
    async writePresetAudio(userId, moduleId, presetId, audio) {
      await checkPresetAudio(userId, moduleId, audio);
      return db.runTransaction(async (tx) => {
        const ref = moduleRef(userId, moduleId).collection("presets").doc(presetId);
        const document = await tx.get(ref);
        if (!document.exists) throw new ApiError(404, "Preset introuvable.");
        const current = modulePresetSchema.parse({ id: document.id, ...document.data() });
        const { audio: _previousAudio, ...withoutAudio } = current;
        const updated = modulePresetSchema.parse({
          ...withoutAudio, ...(audio ? { audio } : {}), updatedAt: new Date().toISOString(),
        });
        checkDocumentSize(updated);
        tx.set(ref, updated);
        return updated;
      });
    },
    async putModuleMedia(userId, moduleId, mediaId, bytes, mimeType) {
      const ref = moduleRef(userId, moduleId);
      if (!(await ref.get()).exists) throw new ApiError(404, "Module introuvable.");
      const object = bucket.file(moduleObjectPath(userId, moduleId, mediaId));
      try {
        await object.save(bytes, {
          resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: mimeType, cacheControl: "private, no-store" },
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 412) {
          throw new ApiError(409, "Cet identifiant de fichier existe déjà. Utilise un nouvel identifiant.");
        }
        throw error;
      }
      try {
        await ref.collection("media").doc(mediaId).create({ mimeType, sizeBytes: bytes.length, createdAt: FieldValue.serverTimestamp() });
      } catch (error) {
        try { await object.delete(); } catch (cleanupError) { console.error("Échec du nettoyage du fichier", cleanupError); }
        throw error;
      }
    },
    async getModuleMedia(userId, moduleId, mediaId) {
      const ref = moduleRef(userId, moduleId);
      if (!(await ref.get()).exists) throw new ApiError(404, "Module introuvable.");
      const metadata = await ref.collection("media").doc(mediaId).get();
      if (!metadata.exists) throw new ApiError(404, "Fichier introuvable.");
      const [bytes] = await bucket.file(moduleObjectPath(userId, moduleId, mediaId)).download();
      return { bytes, mimeType: metadata.data()!.mimeType };
    },
    async putMedia(userId, themeId, mediaId, bytes, mimeType) {
      const ref = await recordRef(userId, themeId);
      if (!(await ref.get()).exists) throw new ApiError(404, "Thème introuvable.");
      const object = bucket.file(objectPath(userId, themeId, mediaId));
      try {
        await object.save(bytes, {
          resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: mimeType, cacheControl: "private, no-store" },
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === 412) {
          throw new ApiError(409, "Cet identifiant de fichier existe déjà. Utilise un nouvel identifiant.");
        }
        throw error;
      }
      try {
        await ref.collection("media").doc(mediaId).create({ mimeType, sizeBytes: bytes.length, createdAt: FieldValue.serverTimestamp() });
      } catch (error) {
        try { await object.delete(); } catch (cleanupError) { console.error("Échec du nettoyage du fichier", cleanupError); }
        throw error;
      }
    },
    async getMedia(userId, themeId, mediaId) {
      const ref = await recordRef(userId, themeId);
      if (!(await ref.get()).exists) throw new ApiError(404, "Thème introuvable.");
      let metadata = await ref.collection("media").doc(mediaId).get();
      if (!metadata.exists) metadata = await theme(userId, themeId).collection("media").doc(mediaId).get();
      if (!metadata.exists) throw new ApiError(404, "Fichier introuvable.");
      const [bytes] = await bucket.file(objectPath(userId, themeId, mediaId)).download();
      return { bytes, mimeType: metadata.data()!.mimeType };
    },
  };
}
