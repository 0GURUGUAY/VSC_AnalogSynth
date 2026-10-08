export type AudioAttachment = {
  id: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  createdAt: string;
};

export type MidiAttachment = {
  id: string;
  name: string;
  mimeType: "audio/midi";
  sizeBytes: number;
  createdAt: string;
};

export type ThemeMetadata = {
  id: string;
  name: string;
  bpm: number;
  key: string;
  artist?: string;
  project?: string;
  genre?: string;
  timeSignature?: string;
  status?: "idea" | "in-progress" | "finished";
  abletonProject?: string;
  abletonTrack?: string;
  abletonScene?: string;
  tags?: string;
  notes?: string;
  midiFiles?: MidiAttachment[];
  masterClockFacadeId?: string;
  musicians?: string;
};

export type MusicPatch = {
  id: string;
  name: string;
  notes: string;
  moduleInstanceIds: string[];
};

export type PatchCable = {
  id: string;
  source: string;
  destination: string;
  color: string;
  midiChannel?: number;
  carriesClock?: boolean;
  sourceInstanceId?: string;
  sourcePortId?: string;
  destinationInstanceId?: string;
  destinationPortId?: string;
};

export type JackDirection = "input" | "output" | "bidirectional";

export type JackPort = {
  id: string;
  label: string;
  direction: JackDirection;
  /** Emplacement quand le connecteur n'est pas sur la façade (ex. « Face arrière »). */
  location?: string;
};

export type ControlKind = "knob" | "slider";

export type ControlDef = {
  id: string;
  label: string;
  hint?: string;
  /** Potentiomètre rotatif (défaut) ou linéaire (fader). */
  kind?: ControlKind;
};

export type VisionControl = {
  label: string;
  kind?: ControlKind;
  angleDegrees: number | null;
  /** Curseurs linéaires : 0 = course minimale (bas ou gauche), 100 = maximale (haut ou droite). */
  positionPercent?: number | null;
  confidence: number;
};

export type VisionJackPort = {
  label: string;
  direction: JackDirection;
  confidence: number;
};

export type PanelVisionAnalysis = {
  moduleName: string | null;
  manufacturer: string | null;
  controls: VisionControl[];
  jacks: VisionJackPort[];
  model: string | null;
  summary: string;
};

export type PanelAnalysis = Omit<PanelVisionAnalysis, "controls" | "jacks"> & {
  controls: (ControlDef & { value: number | null; angleDegrees: number | null; confidence: number })[];
  jacks: (JackPort & { confidence: number })[];
};

export type Facade = {
  id: string;
  moduleId?: string;
  presetId?: string;
  name: string;
  createdAt: string;
  photoId?: string;
  moduleName?: string;
  controls?: ControlDef[];
  jacks?: JackPort[];
  /** Ancien format : migré vers les lignes de patch à la lecture. */
  midiChannel?: number;
  values: Record<string, number | null>;
  model: string;
  notes: string;
  cables: PatchCable[];
  recordings: AudioAttachment[];
};

export type ModulePreset = {
  id: string;
  name: string;
  values: Record<string, number | null>;
  notes: string;
  createdAt: string;
  updatedAt: string;
  audio?: AudioAttachment;
};

export type LibraryModule = {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  photoId?: string;
  controls: ControlDef[];
  jacks: JackPort[];
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  version: 2 | 3;
  set: ThemeMetadata;
  patches?: MusicPatch[];
  activePatchId?: string;
  module: {
    name: string;
    manufacturer: string;
    facades: Facade[];
    activeFacadeId: string;
  };
};

/** Format v1 : un seul état de module + instantanés sans photo ni sons. */
export type LegacyWorkspace = {
  set: Omit<ThemeMetadata, "id"> & { id?: string };
  module: {
    name: string;
    manufacturer: string;
    values: Record<string, number | null>;
    model: string;
    notes: string;
    photoId?: string;
    cables: PatchCable[];
    recordings: AudioAttachment[];
  };
  snapshots?: {
    id: string;
    createdAt: string;
    values: Record<string, number | null>;
    model: string;
    notes: string;
    cables: PatchCable[];
    recordingCount: number;
  }[];
};
