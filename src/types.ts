export type AudioAttachment = {
  id: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  createdAt: string;
};

export type PatchCable = {
  id: string;
  source: string;
  destination: string;
  color: string;
};

export type JackDirection = "input" | "output";

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
  name: string;
  createdAt: string;
  photoId?: string;
  moduleName?: string;
  controls?: ControlDef[];
  jacks?: JackPort[];
  values: Record<string, number | null>;
  model: string;
  notes: string;
  cables: PatchCable[];
  recordings: AudioAttachment[];
};

export type Workspace = {
  version: 2;
  set: {
    name: string;
    bpm: number;
    key: string;
  };
  module: {
    name: string;
    manufacturer: string;
    facades: Facade[];
    activeFacadeId: string;
  };
};

/** Format v1 : un seul état de module + instantanés sans photo ni sons. */
export type LegacyWorkspace = {
  set: Workspace["set"];
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
