import { z } from "zod";
import type { LibraryModule, ModulePreset, Workspace } from "../src/types";
import { migratePatchMidi } from "../src/patch";
import { AUDIO_MIME_TYPES } from "../src/audio";

export const idSchema = z.string().uuid();
const text = z.string().max(500);
const timestamp = z.iso.datetime();
const audioSchema = z.strictObject({
  id: idSchema, name: text, mimeType: z.string().max(100),
  durationSeconds: z.number().finite().nonnegative(), createdAt: timestamp,
});
export const presetAudioSchema = audioSchema.extend({ mimeType: z.enum(AUDIO_MIME_TYPES) });
export const writePresetAudioSchema = z.strictObject({ audio: presetAudioSchema.nullable() });
const controlSchema = z.strictObject({
  id: z.string().min(1).max(100), label: text, hint: text.optional(), kind: z.enum(["knob", "slider"]).optional(),
});
const jackSchema = z.strictObject({
  id: z.string().min(1).max(100), label: text, direction: z.enum(["input", "output", "bidirectional"]), location: text.optional(),
});
export const libraryModuleSchema: z.ZodType<LibraryModule> = z.strictObject({
  id: idSchema, name: z.string().trim().min(1).max(500), manufacturer: text, model: text,
  photoId: idSchema.optional(), controls: z.array(controlSchema).max(64), jacks: z.array(jackSchema).max(100),
  createdAt: timestamp, updatedAt: timestamp,
}).superRefine((module, context) => {
  const controlIds = module.controls.map((control) => control.id);
  const jackIds = module.jacks.map((jack) => jack.id);
  if (new Set(controlIds).size !== controlIds.length || module.controls.some((control) => !control.label.trim())) {
    context.addIssue({ code: "custom", path: ["controls"], message: "Chaque contrôle doit avoir un identifiant unique et un nom." });
  }
  if (new Set(jackIds).size !== jackIds.length || module.jacks.some((jack) => !jack.label.trim())) {
    context.addIssue({ code: "custom", path: ["jacks"], message: "Chaque port doit avoir un identifiant unique et un nom." });
  }
});
export const modulePresetSchema: z.ZodType<ModulePreset> = z.strictObject({
  id: idSchema, name: z.string().trim().min(1).max(500),
  values: z.record(z.string().max(100), z.number().finite().min(0).max(100).nullable()),
  notes: z.string().max(10000), createdAt: timestamp, updatedAt: timestamp,
  audio: presetAudioSchema.optional(),
});
const themeSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(500),
  bpm: z.number().finite().min(1).max(999),
  key: text,
  artist: text.optional(), project: text.optional(), genre: text.optional(),
  timeSignature: text.optional(), status: z.enum(["idea", "in-progress", "finished"]).optional(),
  abletonProject: text.optional(), abletonTrack: text.optional(), abletonScene: text.optional(),
  tags: text.optional(), notes: z.string().max(10000).optional(),
  masterClockFacadeId: idSchema.optional(),
  musicians: text.optional(),
  midiFiles: z.array(z.strictObject({
    id: idSchema, name: text, mimeType: z.literal("audio/midi"),
    sizeBytes: z.number().int().positive().max(10 * 1024 * 1024), createdAt: timestamp,
  })).max(100).optional(),
});
const facadeSchema = z.strictObject({
  id: idSchema, moduleId: idSchema.optional(), presetId: idSchema.optional(),
  name: text, createdAt: timestamp, photoId: idSchema.optional(), moduleName: text.optional(),
  controls: z.array(controlSchema).max(64).optional(),
  jacks: z.array(jackSchema).max(100).optional(),
  midiChannel: z.number().int().min(1).max(16).optional(),
  values: z.record(z.string().max(100), z.number().finite().min(0).max(100).nullable()),
  model: text, notes: z.string().max(10000),
  cables: z.array(z.strictObject({
    id: idSchema, source: text, destination: text, color: z.string().max(40),
    midiChannel: z.number().int().min(1).max(16).optional(),
    carriesClock: z.boolean().optional(),
    sourceInstanceId: idSchema.optional(), sourcePortId: z.string().min(1).max(100).optional(),
    destinationInstanceId: idSchema.optional(), destinationPortId: z.string().min(1).max(100).optional(),
  })).max(500),
  recordings: z.array(audioSchema).max(200),
});

export const workspaceSchema: z.ZodType<Workspace> = z.strictObject({
  version: z.union([z.literal(2), z.literal(3)]),
  set: themeSchema,
  patches: z.array(z.strictObject({
    id: idSchema, name: z.string().trim().min(1).max(500),
    notes: z.string().max(10000), moduleInstanceIds: z.array(idSchema).max(100),
  })).max(100).optional(),
  activePatchId: idSchema.optional(),
  module: z.strictObject({
    name: text, manufacturer: text, facades: z.array(facadeSchema).max(100), activeFacadeId: z.union([idSchema, z.literal("")]),
  }),
}).superRefine((workspace, context) => {
  const ids = workspace.module.facades.map((facade) => facade.id);
  if (workspace.version === 3) {
    const patches = workspace.patches ?? [];
    const patchIds = patches.map((patch) => patch.id);
    const members = patches.flatMap((patch) => patch.moduleInstanceIds);
    if (!patches.length || new Set(patchIds).size !== patchIds.length || !patchIds.includes(workspace.activePatchId ?? "")) {
      context.addIssue({ code: "custom", path: ["patches"], message: "Le SET doit avoir des PATCHES uniques et un PATCH actif valide." });
    }
    if (new Set(members).size !== members.length || members.length !== ids.length || members.some((id) => !ids.includes(id))) {
      context.addIssue({ code: "custom", path: ["patches"], message: "Chaque module doit appartenir à exactement un PATCH du SET." });
    }
  } else if (workspace.patches !== undefined || workspace.activePatchId !== undefined) {
    context.addIssue({ code: "custom", message: "Les PATCHES nécessitent le format SET version 3." });
  }
  const patchIds = workspace.module.facades.flatMap((facade) => facade.cables.map((cable) => cable.id));
  for (const facade of workspace.module.facades) {
    for (const cable of facade.cables) {
      for (const [instanceId, portId] of [[cable.sourceInstanceId, cable.sourcePortId], [cable.destinationInstanceId, cable.destinationPortId]]) {
        if (Boolean(instanceId) !== Boolean(portId) || (instanceId && !ids.includes(instanceId))) {
          context.addIssue({ code: "custom", message: "Extrémité de câble absente du SET ou incomplète." });
        }
      }
      if (cable.destinationInstanceId && cable.destinationInstanceId !== facade.id) {
        context.addIssue({ code: "custom", message: "Le câble doit être associé à son module de destination." });
      }
    }
  }
  const activeMembers = workspace.version === 3
    ? workspace.patches?.find((patch) => patch.id === workspace.activePatchId)?.moduleInstanceIds ?? []
    : ids;
  if (new Set(ids).size !== ids.length || (activeMembers.length ? !activeMembers.includes(workspace.module.activeFacadeId) : workspace.module.activeFacadeId !== "")) {
    context.addIssue({ code: "custom", message: "Façades dupliquées ou façade active absente." });
  }
  if (new Set(patchIds).size !== patchIds.length) {
    context.addIssue({ code: "custom", message: "Chaque câble doit avoir son propre identifiant." });
  }
  if (workspace.set.masterClockFacadeId && !ids.includes(workspace.set.masterClockFacadeId)) {
    context.addIssue({ code: "custom", path: ["set", "masterClockFacadeId"], message: "L'appareil MASTER CLOCK est absent du SET." });
  }
  const mediaIds = [
    ...(workspace.set.midiFiles ?? []).map((file) => file.id),
    ...workspace.module.facades.flatMap((facade) => [
      ...(facade.photoId && !facade.moduleId ? [facade.photoId] : []), ...facade.recordings.map((file) => file.id),
    ]),
  ];
  if (new Set(mediaIds).size !== mediaIds.length) {
    context.addIssue({ code: "custom", message: "Chaque fichier doit avoir son propre identifiant." });
  }
}).transform(migratePatchMidi);

export const writeSchema = z.strictObject({
  workspace: workspaceSchema,
  revision: z.number().int().nonnegative(),
});

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function checkDocumentSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 800_000) {
    throw new ApiError(413, "Trop de données dans un document. Réduis le nombre de contrôles, patchs ou sons.");
  }
}
