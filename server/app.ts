import express from "express";
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, z } from "zod";
import { ApiError, idSchema, libraryModuleSchema, modulePresetSchema, writeSchema, writePresetAudioSchema } from "./schema";
import { AUDIO_MIME_TYPES, audioMimeType, MAX_AUDIO_BYTES } from "../src/audio";
import type { CloudStore } from "./store";
import { validateMidiBytes } from "../src/midi";
import { installRingsAi } from "../vite-rings-ai";
import { rateLimit } from "express-rate-limit";

type Identity = { sub: string; email?: string; name?: string };
type Options = {
  store: CloudStore;
  verifyToken: (token: string) => Promise<Identity>;
  allowedOrigins: string[];
  geminiApiKey?: string;
};
const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (request, response, next) => { void handler(request, response, next).catch(next); };

export function createApp(options: Options) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
  app.use("/api", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (origin) {
      if (!options.allowedOrigins.includes(origin)) {
        response.status(403).json({ error: "Origine non autorisée." });
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Media-Type");
    }
    if (request.method === "OPTIONS") { response.sendStatus(204); return; }
    next();
  });
  app.use("/api", asyncRoute(async (request, response, next) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ") || header.length > 8192) throw new ApiError(401, "Connexion Google requise.");
    let identity: Identity;
    try {
      identity = await options.verifyToken(header.slice(7));
    } catch (error) {
      console.warn("Vérification Google refusée", error instanceof Error ? error.name : "Erreur");
      throw new ApiError(401, "Connexion Google expirée ou invalide.");
    }
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(identity.sub)) throw new ApiError(401, "Identifiant Google invalide.");
    response.locals.identity = identity;
    next();
  }));
  app.get("/api/auth/me", (_request, response) => response.json(response.locals.identity));
  app.get("/api/settings/gemini", asyncRoute(async (_request, response) => {
    const key = await options.store.readGeminiApiKey(response.locals.identity.sub);
    response.json({ configured: Boolean(key), serverAvailable: Boolean(options.geminiApiKey) });
  }));
  app.put("/api/settings/gemini", express.json({ limit: "2kb" }), asyncRoute(async (request, response) => {
    const { apiKey } = z.object({
      apiKey: z.string().trim().regex(/^[A-Za-z0-9_-]{20,200}$/).nullable(),
    }).strict().parse(request.body);
    await options.store.writeGeminiApiKey(response.locals.identity.sub, apiKey);
    response.json({ configured: Boolean(apiKey), serverAvailable: Boolean(options.geminiApiKey) });
  }));
  app.get("/api/themes", asyncRoute(async (_request, response) => {
    response.json({ themes: await options.store.list(response.locals.identity.sub), limit: 100 });
  }));
  app.get("/api/sets", asyncRoute(async (_request, response) => {
    response.json({ sets: await options.store.list(response.locals.identity.sub), limit: 100 });
  }));
  // Reuse the validated legacy routes for record and media operations.
  app.use((request, _response, next) => {
    request.url = request.url.replace(/^\/api\/sets(?=\/|$|\?)/, "/api/themes");
    next();
  });
  app.get("/api/modules", asyncRoute(async (_request, response) => {
    response.json({ modules: await options.store.listModules(response.locals.identity.sub) });
  }));
  app.put("/api/modules/:moduleId", express.json({ limit: "1mb" }), asyncRoute(async (request, response) => {
    const id = idSchema.parse(request.params.moduleId);
    const module = libraryModuleSchema.parse(request.body);
    if (module.id !== id) throw new ApiError(400, "Identifiant du module incohérent.");
    response.json({ module: await options.store.writeModule(response.locals.identity.sub, module) });
  }));
  app.get("/api/modules/:moduleId/presets", asyncRoute(async (request, response) => {
    const id = idSchema.parse(request.params.moduleId);
    response.json({ presets: await options.store.listPresets(response.locals.identity.sub, id) });
  }));
  app.put("/api/modules/:moduleId/presets/:presetId", express.json({ limit: "1mb" }), asyncRoute(async (request, response) => {
    const moduleId = idSchema.parse(request.params.moduleId);
    const preset = modulePresetSchema.parse(request.body);
    if (preset.id !== idSchema.parse(request.params.presetId)) throw new ApiError(400, "Identifiant du preset incohérent.");
    response.json({ preset: await options.store.writePreset(response.locals.identity.sub, moduleId, preset) });
  }));
  app.put("/api/modules/:moduleId/presets/:presetId/audio", express.json({ limit: "10kb" }), asyncRoute(async (request, response) => {
    const moduleId = idSchema.parse(request.params.moduleId);
    const presetId = idSchema.parse(request.params.presetId);
    const { audio } = writePresetAudioSchema.parse(request.body);
    response.json({ preset: await options.store.writePresetAudio(response.locals.identity.sub, moduleId, presetId, audio) });
  }));
  app.put("/api/modules/:moduleId/media/:mediaId", express.raw({ type: "application/octet-stream", limit: MAX_AUDIO_BYTES }), asyncRoute(async (request, response) => {
    const moduleId = idSchema.parse(request.params.moduleId);
    const mediaId = idSchema.parse(request.params.mediaId);
    const mimeType = z.enum(["image/jpeg", "image/png", "image/webp", ...AUDIO_MIME_TYPES])
      .parse(typeof request.headers["x-media-type"] === "string" ? audioMimeType(request.headers["x-media-type"]) : undefined);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new ApiError(400, "Fichier vide ou Content-Type incorrect.");
    if (mimeType.startsWith("image/") && request.body.length > 8 * 1024 * 1024) throw new ApiError(413, "Photo trop volumineuse (8 Mio maximum).");
    await options.store.putModuleMedia(response.locals.identity.sub, moduleId, mediaId, request.body, mimeType);
    response.status(201).json({ id: mediaId, mimeType, sizeBytes: request.body.length });
  }));
  app.get("/api/modules/:moduleId/media/:mediaId", asyncRoute(async (request, response) => {
    const moduleId = idSchema.parse(request.params.moduleId);
    const mediaId = idSchema.parse(request.params.mediaId);
    const file = await options.store.getModuleMedia(response.locals.identity.sub, moduleId, mediaId);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", "attachment");
    response.send(file.bytes);
  }));
  app.use("/api/themes/:themeId", (request, _response, next) => {
    const result = idSchema.safeParse(request.params.themeId);
    if (!result.success) { next(new ApiError(400, "Identifiant de thème invalide.")); return; }
    next();
  });
  app.get("/api/themes/:themeId", asyncRoute(async (request, response) => {
    response.json(await options.store.read(response.locals.identity.sub, request.params.themeId));
  }));
  const saveTheme = (create: boolean) => asyncRoute(async (request, response) => {
    const { workspace, revision } = writeSchema.parse(request.body);
    if (create ? revision !== 0 : revision < 1 || workspace.set.id !== request.params.themeId) {
      throw new ApiError(400, "Identifiant ou révision incohérent.");
    }
    response.status(create ? 201 : 200).json(await options.store.write(response.locals.identity.sub, workspace, revision));
  });
  app.post("/api/themes", express.json({ limit: "5mb" }), saveTheme(true));
  app.put("/api/themes/:themeId", express.json({ limit: "5mb" }), saveTheme(false));

  app.put("/api/themes/:themeId/media/:mediaId", express.raw({ type: "application/octet-stream", limit: "25mb" }), asyncRoute(async (request, response) => {
    const mediaId = idSchema.parse(request.params.mediaId);
    const mimeType = z.enum([
      "image/jpeg", "image/png", "image/webp", "audio/midi",
      "audio/webm", "audio/webm;codecs=opus", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/ogg",
    ]).parse(request.headers["x-media-type"]);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) throw new ApiError(400, "Fichier vide ou Content-Type incorrect.");
    if (mimeType === "audio/midi") {
      try { validateMidiBytes(request.body); } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : "Fichier MIDI invalide.");
      }
    }
    if (mimeType.startsWith("image/") && request.body.length > 8 * 1024 * 1024) throw new ApiError(413, "Photo trop volumineuse (8 Mio maximum).");
    await options.store.putMedia(response.locals.identity.sub, request.params.themeId, mediaId, request.body, mimeType);
    response.status(201).json({ id: mediaId, mimeType, sizeBytes: request.body.length });
  }));
  app.get("/api/themes/:themeId/media/:mediaId", asyncRoute(async (request, response) => {
    const mediaId = idSchema.parse(request.params.mediaId);
    const file = await options.store.getMedia(response.locals.identity.sub, request.params.themeId, mediaId);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", "attachment");
    response.send(file.bytes);
  }));
  app.use("/api/rings", rateLimit({
    windowMs: 60_000, limit: 10,
    keyGenerator: (_request, response) => response.locals.identity.sub,
    standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Limite IA atteinte : 10 requêtes par minute et par compte sur cette instance." },
  }));
  app.use("/api/rings", asyncRoute(async (_request, response, next) => {
    response.locals.geminiApiKey = await options.store.readGeminiApiKey(response.locals.identity.sub) ?? options.geminiApiKey ?? "";
    next();
  }));
  installRingsAi(app, (_request, response) => (response as Response).locals.geminiApiKey);
  app.use("/api", (_request, response) => response.status(404).json({ error: "Route API introuvable." }));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) { next(error); return; }
    if (error instanceof ApiError) { response.status(error.status).json({ error: error.message }); return; }
    if (error instanceof ZodError) { response.status(400).json({ error: "Données invalides.", issues: error.issues.map(({ path, message }) => ({ path, message })) }); return; }
    if (typeof error === "object" && error !== null && "type" in error) {
      if (error.type === "entity.too.large") { response.status(413).json({ error: "Requête trop volumineuse." }); return; }
      if (error.type === "entity.parse.failed") { response.status(400).json({ error: "JSON invalide." }); return; }
    }
    console.error("Erreur API", error);
    response.status(500).json({ error: "Erreur du serveur. Les données n'ont pas été confirmées comme sauvegardées." });
  };
  app.use(errors);
  return app;
}
