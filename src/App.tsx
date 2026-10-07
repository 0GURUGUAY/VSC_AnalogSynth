import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Disc3,
  Download,
  Headphones,
  ImagePlus,
  Images,
  Menu,
  Mic,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  SlidersHorizontal,
  Sparkles,
  Square,
  ScanSearch,
  Trash2,
  Upload,
  Volume2,
  Waves,
  X,
  Zap,
} from "lucide-react";
import ringsPhoto from "../rings.jpg";
import { analyzePanelPhoto, findHiddenJacks } from "./ai";
import { deleteMedia, loadMedia, loadWorkspace, saveMedia, saveWorkspace } from "./storage";
import type { AudioAttachment, ControlDef, Facade, JackPort, PanelAnalysis, PatchCable, Workspace } from "./types";

const defaultControls: ControlDef[] = [
  { id: "frequency", label: "Frequency", hint: "Hauteur de résonance" },
  { id: "structure", label: "Structure", hint: "Organisation harmonique" },
  { id: "brightness", label: "Brightness", hint: "Timbre / éclat" },
  { id: "damping", label: "Damping", hint: "Amortissement" },
  { id: "position", label: "Position", hint: "Position dans la structure" },
];

function facadeControls(facade: Facade): ControlDef[] {
  return facade.controls?.length ? facade.controls : defaultControls;
}

function makeId(): string {
  return crypto.randomUUID();
}

function createFacade(name: string, from?: Facade): Facade {
  return {
    id: makeId(),
    name,
    createdAt: new Date().toISOString(),
    values: from ? { ...from.values } : Object.fromEntries(defaultControls.map(({ id }) => [id, null])),
    moduleName: from?.moduleName,
    controls: from?.controls?.map((control) => ({ ...control })),
    jacks: from?.jacks?.map((jack) => ({ ...jack })),
    model: from?.model ?? "",
    notes: from?.notes ?? "",
    cables: from ? from.cables.map((cable) => ({ ...cable, id: makeId() })) : [],
    recordings: [],
  };
}

const firstFacade = createFacade("Façade 1");
const initialWorkspace: Workspace = {
  version: 2,
  set: { name: "Thème 1", bpm: 90, key: "E majeur" },
  module: {
    name: "Rings",
    manufacturer: "Mutable Instruments",
    facades: [firstFacade],
    activeFacadeId: firstFacade.id,
  },
};

function nextFacadeName(facades: Facade[]): string {
  let index = facades.length + 1;
  while (facades.some((facade) => facade.name === `Façade ${index}`)) index += 1;
  return `Façade ${index}`;
}

function safeFileName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "son";
}

function useMediaUrl(id?: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!id) return;
    let currentUrl = "";
    let active = true;
    loadMedia(id).then((blob) => {
      if (!active || !blob) return;
      currentUrl = URL.createObjectURL(blob);
      setUrl(currentUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [id]);
  return url;
}

function FacadeCard({
  facade,
  active,
  playing,
  disabled,
  onSelect,
  onPlay,
}: {
  facade: Facade;
  active: boolean;
  playing: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPlay: () => void;
}) {
  const url = useMediaUrl(facade.photoId);
  const count = facade.recordings.length;
  return (
    <div className={`facade-card ${active ? "active" : ""}`}>
      <button className="facade-select" onClick={onSelect} disabled={disabled && !active} aria-pressed={active} aria-label={`Sélectionner ${facade.name}`}>
        <span className="facade-thumb">{url ? <img src={url} alt="" /> : <span className="facade-thumb-empty"><Camera size={18} />Sans photo</span>}</span>
        <span className="facade-info">
          <strong>{facade.name}</strong>
          <small className={count > 0 ? "has-sound" : ""}><AudioLines size={11} /> {count === 0 ? "Aucun son" : `${count} son${count > 1 ? "s" : ""}`}</small>
        </span>
      </button>
      {count > 0 && <button className={`facade-play ${playing ? "playing" : ""}`} onClick={onPlay} disabled={disabled} aria-label={playing ? `Arrêter le son de ${facade.name}` : `Écouter le dernier son de ${facade.name}`}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function AudioPlayer({ attachment, onRemove }: { attachment: AudioAttachment; onRemove: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let currentUrl = "";
    let active = true;
    loadMedia(attachment.id).then((blob) => {
      if (!active) return;
      if (!blob) {
        setError("Fichier introuvable dans le stockage local.");
        return;
      }
      currentUrl = URL.createObjectURL(blob);
      setUrl(currentUrl);
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Erreur de lecture du fichier.");
    });
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [attachment.id]);

  return (
    <div className="recording-item">
      <div className="recording-icon"><AudioLines size={18} /></div>
      <div className="recording-main">
        <strong title={attachment.name}>{attachment.name}</strong>
        <span>{attachment.durationSeconds > 0 ? formatDuration(attachment.durationSeconds) : "Durée non renseignée"} <i>·</i> {dateLabel(attachment.createdAt)}</span>
        {error && <small className="error-text">{error}</small>}
        {url && <audio controls preload="metadata" src={url} aria-label={`Écouter ${attachment.name}`} />}
      </div>
      <button className="icon-button remove-audio" onClick={onRemove} aria-label="Supprimer cet enregistrement"><Trash2 size={17} /></button>
    </div>
  );
}

function KnobControl({
  control,
  value,
  onChange,
}: {
  control: ControlDef;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const angle = value === null ? -150 : -150 + (value / 100) * 300;
  const isSlider = control.kind === "slider";
  return (
    <label className={`control-card ${isSlider ? "slider-card" : ""}`}>
      <span className="control-name">{control.label}</span>
      {isSlider ? (
        <span className="fader-shell" style={{ "--fader-pos": `${value ?? 50}%` } as React.CSSProperties} aria-hidden="true">
          <span className="fader-track" />
          <span className={`fader-cap ${value === null ? "unknown" : ""}`} />
        </span>
      ) : <span className="knob-shell" style={{ "--knob-angle": `${angle}deg`, "--knob-progress": `${value === null ? 0 : value * 3}deg` } as React.CSSProperties} aria-hidden="true">
        <span className="knob" />
        <span className="knob-pointer" />
      </span>}
      <span className={`control-value ${value === null ? "unknown" : ""}`}>{value === null ? "À saisir" : `${value}%`}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={value ?? 50}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={`${control.label} : ${value === null ? "non renseigné" : `${value}%`}`}
      />
      <span className="control-hint">{control.hint}</span>
    </label>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [manualSaving, setManualSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeTab, setActiveTab] = useState<"patch" | "sound">("patch");
  const [playingFacadeId, setPlayingFacadeId] = useState("");
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisSuggestion, setAnalysisSuggestion] = useState<PanelAnalysis | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const photoTargetIdRef = useRef("");
  const recordingFacadeIdRef = useRef("");
  const activeFacadeIdRef = useRef("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef("");
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const facades = workspace.module.facades;
  const activeFacade = facades.find((facade) => facade.id === workspace.module.activeFacadeId) ?? facades[0];
  const controls = facadeControls(activeFacade);
  activeFacadeIdRef.current = activeFacade.id;
  const activeIndex = facades.indexOf(activeFacade);
  const photoUrl = useMediaUrl(activeFacade.photoId);
  const totalRecordings = facades.reduce((total, facade) => total + facade.recordings.length, 0);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  const persistWorkspace = useCallback((snapshot: Workspace): Promise<boolean> => {
    setSaveStatus("saving");
    // Serialize writes so an older autosave cannot overwrite a manual save.
    const pending = saveQueueRef.current.then(async () => {
      try {
        await saveWorkspace(snapshot);
        if (workspaceRef.current === snapshot) setSaveStatus("saved");
        return true;
      } catch (reason) {
        if (workspaceRef.current === snapshot) setSaveStatus("error");
        showToast(reason instanceof Error ? reason.message : "Impossible d'enregistrer les données.");
        return false;
      }
    });
    saveQueueRef.current = pending;
    return pending;
  }, [showToast]);

  async function saveActiveFacade() {
    if (!ready || manualSaving) return;
    window.clearTimeout(autosaveTimerRef.current);
    const snapshot = workspace;
    const facadeName = activeFacade.name;
    setManualSaving(true);
    try {
      if (await persistWorkspace(snapshot)) {
        showToast(`« ${facadeName} » sauvegardée sur cet appareil.`);
      }
    } finally {
      setManualSaving(false);
    }
  }

  useEffect(() => {
    loadWorkspace().then((saved) => {
      if (saved) setWorkspace(saved);
      setReady(true);
    }).catch((reason: unknown) => {
      setReady(true);
      setSaveStatus("error");
      showToast(reason instanceof Error ? reason.message : "Impossible de lire les données locales.");
    });
  }, [showToast]);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus("saving");
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistWorkspace(workspace);
    }, 200);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [workspace, ready, persistWorkspace]);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)), 250);
    return () => window.clearInterval(interval);
  }, [recording]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    window.clearTimeout(toastTimerRef.current);
    previewAudioRef.current?.pause();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const knownControls = useMemo(
    () => facadeControls(activeFacade).filter(({ id }) => activeFacade.values[id] != null).length,
    [activeFacade],
  );

  const updateFacade = useCallback((id: string, update: (facade: Facade) => Facade) => {
    setWorkspace((current) => ({
      ...current,
      module: { ...current.module, facades: current.module.facades.map((facade) => facade.id === id ? update(facade) : facade) },
    }));
  }, []);

  function stopPreview() {
    previewAudioRef.current?.pause();
    setPlayingFacadeId("");
  }

  function selectFacade(id: string) {
    if (id === activeFacade.id) return;
    stopPreview();
    setWorkspace((current) => ({ ...current, module: { ...current.module, activeFacadeId: id } }));
  }

  async function togglePreview(facade: Facade) {
    if (playingFacadeId === facade.id) {
      stopPreview();
      return;
    }
    selectFacade(facade.id);
    const latest = facade.recordings[0];
    if (!latest) return;
    try {
      const blob = await loadMedia(latest.id);
      if (!blob) {
        showToast("Fichier audio introuvable dans le stockage local.");
        return;
      }
      const audio = previewAudioRef.current ?? new Audio();
      previewAudioRef.current = audio;
      audio.pause();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(blob);
      audio.src = previewUrlRef.current;
      audio.onended = () => setPlayingFacadeId("");
      setPlayingFacadeId(facade.id);
      await audio.play();
    } catch (reason) {
      setPlayingFacadeId("");
      showToast(reason instanceof Error ? reason.message : "Lecture impossible.");
    }
  }

  function addFacade(duplicate: boolean) {
    stopPreview();
    const facade = createFacade(duplicate ? `${activeFacade.name} (copie)` : nextFacadeName(facades), duplicate ? activeFacade : undefined);
    setWorkspace((current) => ({
      ...current,
      module: { ...current.module, facades: [...current.module.facades, facade], activeFacadeId: facade.id },
    }));
    if (duplicate) {
      showToast("Réglages copiés dans une nouvelle façade. Ajoute sa photo et son son.");
    } else {
      photoTargetIdRef.current = facade.id;
      photoInputRef.current?.click();
    }
    window.setTimeout(() => document.querySelector(".facade-card.active")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 50);
  }

  async function removeFacade() {
    if (facades.length <= 1) return;
    const count = activeFacade.recordings.length;
    if (!window.confirm(`Supprimer « ${activeFacade.name} » ?${count > 0 ? ` Ses ${count} son(s) seront aussi supprimés.` : ""}`)) return;
    stopPreview();
    const removed = activeFacade;
    const fallback = facades[activeIndex + 1] ?? facades[activeIndex - 1];
    setWorkspace((current) => ({
      ...current,
      module: { ...current.module, facades: current.module.facades.filter((facade) => facade.id !== removed.id), activeFacadeId: fallback.id },
    }));
    await deleteMedia([...(removed.photoId ? [removed.photoId] : []), ...removed.recordings.map((item) => item.id)]).catch(() => undefined);
    showToast(`« ${removed.name} » supprimée.`);
  }

  function addRecordingTo(facadeId: string, attachment: AudioAttachment) {
    updateFacade(facadeId, (facade) => ({ ...facade, recordings: [attachment, ...facade.recordings] }));
  }

  function updateSet<K extends keyof Workspace["set"]>(field: K, value: Workspace["set"][K]) {
    setWorkspace((current) => ({ ...current, set: { ...current.set, [field]: value } }));
  }

  function updateFacadeField(field: "model" | "notes" | "name", value: string) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, [field]: value }));
  }

  function updateControl(id: string, value: number) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, values: { ...facade.values, [id]: value } }));
  }

  function updateCable(id: string, field: keyof Omit<PatchCable, "id">, value: string) {
    updateFacade(activeFacade.id, (facade) => ({
      ...facade,
      cables: facade.cables.map((cable) => cable.id === id ? { ...cable, [field]: value } : cable),
    }));
  }

  function updateJack(id: string, update: Partial<JackPort>) {
    updateFacade(activeFacade.id, (facade) => ({
      ...facade,
      jacks: (facade.jacks ?? []).map((jack) => jack.id === id ? { ...jack, ...update } : jack),
    }));
  }

  function addJack() {
    const jack: JackPort = { id: makeId(), label: "", direction: "input" };
    updateFacade(activeFacade.id, (facade) => ({ ...facade, jacks: [...(facade.jacks ?? []), jack] }));
  }

  function removeJack(id: string) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, jacks: (facade.jacks ?? []).filter((jack) => jack.id !== id) }));
  }

  function addCable() {
    const cable: PatchCable = { id: makeId(), source: "", destination: "", color: "pink" };
    updateFacade(activeFacade.id, (facade) => ({ ...facade, cables: [...facade.cables, cable] }));
  }

  function removeCable(id: string) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, cables: facade.cables.filter((cable) => cable.id !== id) }));
  }

  async function handlePhoto(file?: File) {
    const targetId = photoTargetIdRef.current || activeFacade.id;
    photoTargetIdRef.current = "";
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choisis un fichier image.");
      return;
    }
    const id = makeId();
    try {
      await saveMedia(id, file);
      const previousPhotoId = facades.find((facade) => facade.id === targetId)?.photoId;
      updateFacade(targetId, (facade) => ({ ...facade, photoId: id }));
      setAnalysisSuggestion(null);
      setAnalysisError("");
      if (previousPhotoId) void deleteMedia([previousPhotoId]).catch(() => undefined);
      showToast("Photo enregistrée. Analyse IA et recherche des connecteurs cachés en cours…");
      void analyzePhoto(id, targetId);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Impossible d'enregistrer la photo.");
    }
  }

  function choosePhoto() {
    photoTargetIdRef.current = activeFacade.id;
    photoInputRef.current?.click();
  }

  async function analyzePhoto(photoId = activeFacade.photoId, targetFacadeId = activeFacade.id) {
    if (!photoId || analyzingPhoto) return;
    setAnalyzingPhoto(true);
    setAnalysisError("");
    setAnalysisSuggestion(null);
    try {
      const photo = await loadMedia(photoId);
      if (!photo) throw new Error("Photo introuvable dans le stockage local. Ajoute-la à nouveau.");
      const suggestion = await analyzePanelPhoto(photo);
      try {
        const hidden = await findHiddenJacks({
          moduleName: suggestion.moduleName,
          manufacturer: suggestion.manufacturer,
          visibleJacks: suggestion.jacks.map((jack) => jack.label),
        });
        suggestion.jacks = [
          ...suggestion.jacks,
          ...hidden.map((jack, index) => ({ id: `hidden-${index + 1}-${makeId().slice(0, 8)}`, label: jack.label, direction: jack.direction, location: jack.location, confidence: 0.7 })),
        ];
      } catch (reason) {
        showToast(`Connecteurs cachés non vérifiés : ${reason instanceof Error ? reason.message : "recherche impossible."}`);
      }
      if (activeFacadeIdRef.current === targetFacadeId) setAnalysisSuggestion(suggestion);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "L’analyse de la photo a échoué.";
      setAnalysisError(message);
      showToast(message);
    } finally {
      setAnalyzingPhoto(false);
    }
  }

  function applyAnalysis() {
    if (!analysisSuggestion) return;
    const suggestion = analysisSuggestion;
    updateFacade(activeFacade.id, (facade) => ({
      ...facade,
      moduleName: suggestion.moduleName ?? facade.moduleName,
      controls: suggestion.controls.map(({ id, label, kind }) => ({ id, label, kind })),
      jacks: suggestion.jacks.map(({ id, label, direction, location }) => ({ id, label, direction, ...(location ? { location } : {}) })),
      values: Object.fromEntries(suggestion.controls.map(({ id, value }) => [id, value])),
      model: suggestion.model ?? facade.model,
    }));
    setAnalysisSuggestion(null);
    setAnalysisError("");
    showToast("Estimations ajoutées aux réglages. Tu peux encore les corriger avec les curseurs.");
  }

  async function attachAudioFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(m4a|wav|mp3|aac|ogg|flac)$/i.test(file.name)) {
      showToast("Choisis un fichier audio (M4A, WAV, MP3, etc.).");
      return;
    }
    const id = makeId();
    try {
      await saveMedia(id, file);
      const attachment: AudioAttachment = {
        id,
        name: file.name,
        mimeType: file.type || "audio/mp4",
        durationSeconds: 0,
        createdAt: new Date().toISOString(),
      };
      addRecordingTo(activeFacade.id, attachment);
      showToast(`Son ajouté à « ${activeFacade.name} ».`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Impossible d'importer l'audio.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function refreshAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) {
      showToast("Ce navigateur ne permet pas de lister les entrées audio.");
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      setAudioInputs(inputs);
      if (!selectedInput && inputs.length > 0) setSelectedInput(inputs[0].deviceId);
      if (inputs.length === 0) showToast("Aucune entrée audio détectée. Vérifie la connexion USB-C de l'ES-9.");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Impossible de lister les entrées audio.");
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast("La capture audio n'est pas disponible dans ce navigateur.");
      return;
    }
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(selectedInput ? { deviceId: { exact: selectedInput } } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      stopPreview();
      recordingFacadeIdRef.current = activeFacade.id;
      const facadeLabel = activeFacade.name;
      streamRef.current = stream;
      const supportedType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        showToast("Erreur pendant la capture audio. Vérifie l'entrée sélectionnée et les autorisations.");
        setRecording(false);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000));
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        const attachment: AudioAttachment = {
          id: makeId(),
          name: `${safeFileName(workspace.module.name)}-${safeFileName(facadeLabel)}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`,
          mimeType: blob.type,
          durationSeconds,
          createdAt: new Date().toISOString(),
        };
        const targetFacadeId = recordingFacadeIdRef.current;
        saveMedia(attachment.id, blob).then(() => {
          addRecordingTo(targetFacadeId, attachment);
          showToast(`Prise audio associée à « ${facadeLabel} ».`);
        }).catch((reason: unknown) => {
          showToast(reason instanceof Error ? reason.message : "Impossible d'enregistrer la prise audio.");
        });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
        void refreshAudioInputs();
      };
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      recorder.start(500);
      setRecordingSeconds(0);
      setRecording(true);
      setActiveTab("sound");
      await refreshAudioInputs();
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      showToast(reason instanceof Error ? `Capture refusée : ${reason.message}` : "Capture audio impossible. Vérifie l'accès au microphone.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
  }

  function removeRecording(id: string) {
    if (!window.confirm("Supprimer ce son ?")) return;
    stopPreview();
    updateFacade(activeFacade.id, (facade) => ({ ...facade, recordings: facade.recordings.filter((recordingItem) => recordingItem.id !== id) }));
    void deleteMedia([id]).catch(() => undefined);
  }

  const statusText = saveStatus === "saving" ? "Sauvegarde…" : saveStatus === "error" ? "Erreur de sauvegarde" : "Sauvegardé sur cet appareil";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Analog Memory">
          <span className="brand-mark"><Waves size={19} /></span>
          <span>analog<span className="brand-light">memory</span><small>STUDIO ARCHIVE</small></span>
        </a>
        <div className="topbar-right">
          <div className={`save-indicator ${saveStatus}`}><span />{statusText}</div>
          <button className="profile-chip" aria-label="Profil local"><span>MP</span></button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="workspace-label">ESPACE DE TRAVAIL</div>
          <button className="nav-item active"><Disc3 size={18} /><span>Mes sets</span><span className="nav-count">01</span></button>
          <button className="nav-item muted" onClick={() => showToast("La bibliothèque de modules sera enrichie dans une prochaine étape.")}><SlidersHorizontal size={18} /><span>Modules</span></button>
          <div className="sidebar-separator" />
          <div className="sidebar-section-title"><span>SETS RÉCENTS</span><button className="tiny-icon" aria-label="Ajouter un set" onClick={() => showToast("Le prototype démarre avec un set : Thème 1.")}><Plus size={15} /></button></div>
          <button className="set-nav active-set"><span className="set-dot" /><span><strong>{workspace.set.name || "Sans titre"}</strong><small>{workspace.set.bpm} BPM · {workspace.set.key}</small></span><ChevronDown size={15} /></button>
          <div className="sidebar-bottom">
            <div className="local-card"><span className="local-icon"><Zap size={16} /></span><div><strong>Mode local</strong><small>Données conservées sur l'appareil</small></div></div>
            <span className="version">PROTOTYPE · V0.1</span>
          </div>
        </aside>

        <main className="main-content">
          <div className="breadcrumbs"><span>MES SETS</span><span className="crumb-slash">/</span><strong>{workspace.set.name || "Sans titre"}</strong></div>
          <section className="set-heading">
            <div className="set-title-area">
              <span className="eyebrow"><span className="live-dot" /> SESSION EN COURS</span>
              <input className="set-name" aria-label="Nom du set" value={workspace.set.name} onChange={(event) => updateSet("name", event.target.value)} />
              <p>Un espace pour retrouver exactement le son que tu as créé.</p>
            </div>
            <button className="primary-button save-patch-button" onClick={() => addFacade(false)} disabled={recording}><ImagePlus size={16} /> Nouvelle façade</button>
          </section>

          <section className="set-meta">
            <label className="meta-field"><span className="meta-icon"><Music2 size={16} /></span><span className="meta-label">TEMPO</span><input type="number" min="1" max="999" value={workspace.set.bpm} onChange={(event) => updateSet("bpm", Number(event.target.value))} aria-label="Tempo en BPM" /><span className="meta-unit">BPM</span></label>
            <label className="meta-field"><span className="meta-icon"><Waves size={16} /></span><span className="meta-label">TONALITÉ</span><select value={workspace.set.key} onChange={(event) => updateSet("key", event.target.value)} aria-label="Tonalité">{["C majeur","C# majeur","D majeur","D# majeur","E majeur","F majeur","F# majeur","G majeur","G# majeur","A majeur","A# majeur","B majeur","A mineur","E mineur"].map((key) => <option key={key}>{key}</option>)}</select><ChevronDown size={14} className="select-chevron" /></label>
            <div className="meta-field module-meta"><span className="meta-icon"><Images size={16} /></span><span className="meta-label">FAÇADES</span><strong>{facades.length.toString().padStart(2, "0")} <small>mémorisées</small></strong></div>
            <div className="meta-field capture-meta"><span className="meta-icon"><Headphones size={16} /></span><span className="meta-label">AUDIO</span><strong>{totalRecordings.toString().padStart(2, "0")} <small>prises</small></strong></div>
          </section>

          <section className="facade-section">
            <div className="section-heading">
              <div><span className="eyebrow">{workspace.module.name.toUpperCase()} · {facades.length} FAÇADE{facades.length > 1 ? "S" : ""}</span><h2>Mes façades</h2></div>
              <button className="text-button" onClick={() => addFacade(true)} disabled={recording}><Copy size={14} /> Dupliquer les réglages</button>
            </div>
            <p className="facade-help">Touche une façade pour afficher ses réglages et ses sons. ▶ joue directement le dernier son.</p>
            <div className="facade-gallery">
              {facades.map((facade) => <FacadeCard key={facade.id} facade={facade} active={facade.id === activeFacade.id} playing={playingFacadeId === facade.id} disabled={recording} onSelect={() => selectFacade(facade.id)} onPlay={() => void togglePreview(facade)} />)}
              <button className="facade-add" onClick={() => addFacade(false)} disabled={recording}><ImagePlus size={20} /><strong>Nouvelle façade</strong><small>Photo, réglages et son</small></button>
            </div>
          </section>

          <section className="module-section">
            <div className="section-heading">
              <div><span className="eyebrow">FAÇADE {(activeIndex + 1).toString().padStart(2, "0")} / {facades.length.toString().padStart(2, "0")}</span><h2>Réglages de la façade</h2></div>
              <button className="text-button danger-text" onClick={() => void removeFacade()} disabled={facades.length <= 1 || recording}><Trash2 size={14} /> Supprimer la façade</button>
            </div>

            <article className="module-card">
              <div className="module-card-top">
                <div className="module-identity">
                  <span className="module-avatar"><Waves size={20} /></span>
                  <span><input className="facade-name" aria-label="Nom de la façade" value={activeFacade.name} onChange={(event) => updateFacadeField("name", event.target.value)} /><small>{activeFacade.moduleName ?? workspace.module.name} <span>·</span> {workspace.module.manufacturer}</small></span>
                </div>
                <span className="module-state"><span /> {dateLabel(activeFacade.createdAt).toUpperCase()}</span>
              </div>

              <div className="facade-save-bar">
                <div className="facade-save-feedback">
                  <span className={`save-indicator ${saveStatus}`} role="status"><span />{ready ? statusText : "Chargement…"}</span>
                  <small>Sauvegarde automatique active · stockage local</small>
                </div>
                <button className="primary-button facade-save-button" onClick={() => void saveActiveFacade()} disabled={!ready || manualSaving} aria-label="Sauvegarder la façade" aria-busy={manualSaving}>
                  <Save size={16} />{manualSaving ? "Sauvegarde…" : "SAVE"}
                </button>
              </div>

              <div className="module-overview">
                <div className="panel-reference">
                  <div className="photo-topline"><span>PHOTO DE RÉFÉRENCE</span><button className="photo-action" onClick={choosePhoto}><Camera size={14} /> {photoUrl ? "Changer" : "Ajouter"}</button><input ref={photoInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handlePhoto(event.target.files?.[0])} /></div>
                  <div className="photo-frame">{photoUrl ? <img src={photoUrl} alt={`Photo de ${activeFacade.name}`} /> : <img className="example-photo" src={ringsPhoto} alt="Image d'exemple du module Rings" />}</div>
                  <p className="photo-caption"><CircleHelp size={13} /> {photoUrl ? "Les positions sont à confirmer visuellement." : "Image d'exemple : ajoute la photo de cette façade."}</p>
                  <button className="outline-button analyze-button" onClick={() => void analyzePhoto()} disabled={!activeFacade.photoId || analyzingPhoto || !ready}><ScanSearch size={15} />{analyzingPhoto ? "Analyse en cours…" : "Analyser avec l’IA"}</button>
                  <p className="ai-privacy-note">La photo sera envoyée à Gemini pour cette analyse. Les valeurs restent à vérifier visuellement.</p>
                  {analysisError && <p className="analysis-error" role="alert">{analysisError}</p>}
                  {analysisSuggestion && (
                    <div className="analysis-result" aria-live="polite">
                      <strong>Estimations à confirmer</strong>
                      <p>{analysisSuggestion.summary}</p>
                      {analysisSuggestion.moduleName && <small>Module repéré : {analysisSuggestion.moduleName}{analysisSuggestion.manufacturer ? ` · ${analysisSuggestion.manufacturer}` : ""}</small>}
                      <ul>{analysisSuggestion.controls.map((estimate) => {
                        const { id, label } = estimate;
                        return <li key={id}><span>{label}</span><span>{estimate.value === null ? "Angle non lisible" : `≈ ${estimate.value}% (${estimate.angleDegrees}°)`} · {Math.round(estimate.confidence * 100)}%</span></li>;
                      })}</ul>
                      <strong>Prises jack repérées</strong>
                      {analysisSuggestion.jacks.length > 0 ? (
                        <ul>{analysisSuggestion.jacks.map((jack) => <li key={jack.id}><span>{jack.label}{jack.location ? ` · ${jack.location}` : ""}</span><span>{jack.direction === "input" ? "IN" : "OUT"} · {Math.round(jack.confidence * 100)}%</span></li>)}</ul>
                      ) : <p>Aucune prise jack identifiée.</p>}
                      {analysisSuggestion.model && <small>Modèle repéré : {analysisSuggestion.model}</small>}
                      <div className="analysis-actions">
                        <button className="primary-button" onClick={applyAnalysis}>Appliquer</button>
                        <button className="text-button" onClick={() => setAnalysisSuggestion(null)}>Ignorer</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="control-area">
                  <div className="controls-heading"><div><span className="eyebrow">RÉGLAGES DU PANNEAU</span><h3>Position des contrôles</h3></div><span className="control-progress">{knownControls}/{controls.length} saisis</span></div>
                  <p className="potentiometer-scale-note">Échelle mécanique : 7 h = 0 % · 12 h = 50 % · 5 h = 100 %. L’IA repère l’angle ; l’application calcule le pourcentage.</p>
                  <div className="knob-grid">{controls.map((control) => <KnobControl key={control.id} control={control} value={activeFacade.values[control.id] ?? null} onChange={(value) => updateControl(control.id, value)} />)}</div>
                  <div className="module-options">
                    <label><span>Mode / modèle</span><input value={activeFacade.model} placeholder="Non renseigné" maxLength={80} onChange={(event) => updateFacadeField("model", event.target.value)} /></label>
                    <span className="option-note">À compléter d'après les voyants du module.</span>
                  </div>
                </div>
              </div>

              <div className="jack-section">
                <div className="subsection-heading"><div><span className="subsection-icon"><Radio size={15} /></span><span><strong>Prises jack de la façade</strong><small>Entrées et sorties reconnues par le scan, modifiables et sauvegardées</small></span></div><button className="outline-button" onClick={addJack}><Plus size={15} /> Ajouter un jack</button></div>
                {(activeFacade.jacks ?? []).length === 0 ? (
                  <div className="empty-cables"><span className="empty-cable-icon"><Radio size={17} /></span><span>Aucune prise jack enregistrée.<small>Ajoute une photo et lance le scan pour repérer les IN/OUT.</small></span></div>
                ) : (
                  <div className="jack-list">{activeFacade.jacks?.map((jack, index) => <div className="jack-row" key={jack.id}>
                    <input aria-label={`Nom de la prise jack ${index + 1}`} placeholder={`Jack ${index + 1}`} value={jack.label} onChange={(event) => updateJack(jack.id, { label: event.target.value })} />
                    <select value={jack.direction} aria-label={`Direction de la prise jack ${index + 1}`} onChange={(event) => updateJack(jack.id, { direction: event.target.value === "output" ? "output" : "input" })}>
                      <option value="input">{jack.location ? `IN · ${jack.location}` : "Entrée · IN"}</option>
                      <option value="output">{jack.location ? `OUT · ${jack.location}` : "Sortie · OUT"}</option>
                    </select>
                    <button className="icon-button" onClick={() => removeJack(jack.id)} aria-label={`Supprimer la prise jack ${index + 1}`}><Trash2 size={16} /></button>
                  </div>)}</div>
                )}
              </div>

              <div className="cable-section">
                <div className="subsection-heading"><div><span className="subsection-icon"><Zap size={15} /></span><span><strong>Câblage du patch</strong><small>Entrées et sorties reliées pour ce son</small></span></div><button className="outline-button" onClick={addCable}><Plus size={15} /> Ajouter un câble</button></div>
                {activeFacade.cables.length === 0 ? (
                  <div className="empty-cables"><span className="empty-cable-icon"><Zap size={17} /></span><span>Aucune connexion saisie pour le moment.<small>Indique la sortie, l'entrée et la couleur du câble.</small></span></div>
                ) : (
                  <div className="cable-list">{activeFacade.cables.map((cable, index) => <div className="cable-row" key={cable.id}>
                    <span className={`cable-color ${cable.color}`} />
                    <input aria-label={`Source du câble ${index + 1}`} list={`patch-source-${cable.id}`} placeholder="Sortie (ex. Rings OUT)" value={cable.source} onChange={(event) => updateCable(cable.id, "source", event.target.value)} />
                    <datalist id={`patch-source-${cable.id}`}>{(activeFacade.jacks ?? []).filter((jack) => jack.direction === "output" && jack.label.trim()).map((jack) => <option key={jack.id} value={`${activeFacade.moduleName ?? workspace.module.name} OUT ${jack.label}`} />)}</datalist>
                    <span className="cable-arrow">→</span>
                    <input aria-label={`Destination du câble ${index + 1}`} list={`patch-destination-${cable.id}`} placeholder="Entrée (ex. ES-9 IN 1)" value={cable.destination} onChange={(event) => updateCable(cable.id, "destination", event.target.value)} />
                    <datalist id={`patch-destination-${cable.id}`}>{(activeFacade.jacks ?? []).filter((jack) => jack.direction === "input" && jack.label.trim()).map((jack) => <option key={jack.id} value={`${activeFacade.moduleName ?? workspace.module.name} IN ${jack.label}`} />)}</datalist>
                    <select value={cable.color} aria-label={`Couleur du câble ${index + 1}`} onChange={(event) => updateCable(cable.id, "color", event.target.value)}><option value="pink">Rose</option><option value="blue">Bleu</option><option value="yellow">Jaune</option><option value="green">Vert</option><option value="white">Blanc</option></select>
                    <button className="icon-button" onClick={() => removeCable(cable.id)} aria-label={`Supprimer le câble ${index + 1}`}><Trash2 size={16} /></button>
                  </div>)}</div>
                )}
              </div>

              <label className="notes-field"><span><Menu size={15} /> Notes sur ce patch</span><textarea placeholder="Ex. attaque douce, accord de quinte, modulation lente…" value={activeFacade.notes} onChange={(event) => updateFacadeField("notes", event.target.value)} rows={2} /></label>
            </article>
          </section>

          <section className="recording-section">
            <div className="section-heading recording-heading">
              <div><span className="eyebrow">TRACE SONORE · {activeFacade.name.toUpperCase()}</span><h2>Les sons de cette façade</h2></div>
              <div className="tab-switch" role="tablist" aria-label="Méthode d'ajout de l'audio">
                <button className={activeTab === "patch" ? "selected" : ""} onClick={() => setActiveTab("patch")} role="tab" aria-selected={activeTab === "patch"}><Mic size={14} /> Capturer</button>
                <button className={activeTab === "sound" ? "selected" : ""} onClick={() => setActiveTab("sound")} role="tab" aria-selected={activeTab === "sound"}><Upload size={14} /> Importer</button>
              </div>
            </div>
            {activeTab === "patch" ? (
              <div className="capture-card">
                <span className={`capture-visual ${recording ? "is-recording" : ""}`}>{recording ? <span className="recording-pulse" /> : <AudioLines size={22} />}</span>
                <div className="capture-copy"><strong>{recording ? `Capture en cours pour « ${activeFacade.name} »` : `Prêt à enregistrer « ${activeFacade.name} »`}</strong><span>{recording ? "Le signal de l'entrée sélectionnée est capturé." : "Branche l'ES-9 en USB-C, choisis son entrée, puis lance la prise."}</span></div>
                {recording && <span className="recording-timer"><span />{formatDuration(recordingSeconds)}</span>}
                {!recording ? <button className="record-button" onClick={() => void startRecording()}><span><Play size={15} fill="currentColor" /></span> Démarrer la prise</button> : <button className="stop-button" onClick={stopRecording}><Square size={14} fill="currentColor" /> Arrêter</button>}
              </div>
            ) : (
              <div className="import-card">
                <span className="import-icon"><Download size={19} /></span>
                <div><strong>Importer un enregistrement existant</strong><span>M4A, WAV, MP3 ou autre fichier audio de ton téléphone.</span></div>
                <button className="outline-button" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Choisir un fichier</button>
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="audio/*,.m4a,.aac,.flac" onChange={(event) => void attachAudioFile(event.target.files?.[0])} />
              </div>
            )}
            <div className="audio-input-row">
              <span><Volume2 size={15} /> Source audio Android</span>
              <select value={selectedInput} onChange={(event) => setSelectedInput(event.target.value)} aria-label="Entrée audio de capture">
                {audioInputs.length === 0 ? <option value="">Entrée par défaut (à détecter)</option> : audioInputs.map((input, index) => <option key={input.deviceId || index} value={input.deviceId}>{input.label || `Entrée audio ${index + 1}`}</option>)}
              </select>
              <button className="text-button scan-button" onClick={() => void refreshAudioInputs()}><Radio size={14} /> Détecter</button>
            </div>
            <div className="capture-footnote"><Sparkles size={14} /><span>Pas de réduction de bruit ni de gain automatique demandés, pour préserver le son synthétique. Android peut toutefois appliquer ses propres limites.</span></div>
            {activeFacade.recordings.length > 0 && <div className="recording-list">{activeFacade.recordings.map((attachment) => <AudioPlayer key={attachment.id} attachment={attachment} onRemove={() => removeRecording(attachment.id)} />)}</div>}
            {activeFacade.recordings.length === 0 && <div className="empty-recordings"><Clock3 size={15} /> Aucun son attaché à cette façade.</div>}
          </section>

          <footer className="footer"><span>ANALOG MEMORY · ARCHIVE DE PATCH</span><span>Les données restent sur cet appareil pour le moment.</span></footer>
        </main>
      </div>

      {toast && <div className="toast" role="status"><span><Check size={15} /></span>{toast}<button onClick={() => setToast("")} aria-label="Fermer"><X size={15} /></button></div>}
      <div className="mobile-dock"><button className="dock-active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Disc3 size={18} /><span>Set</span></button><button onClick={() => document.querySelector(".facade-section")?.scrollIntoView({ behavior: "smooth" })}><Images size={18} /><span>Façades</span></button><button onClick={() => document.querySelector(".module-section")?.scrollIntoView({ behavior: "smooth" })}><SlidersHorizontal size={18} /><span>Réglages</span></button><button onClick={() => document.querySelector(".recording-section")?.scrollIntoView({ behavior: "smooth" })}><AudioLines size={18} /><span>Son</span></button></div>
      <div className="sr-only"><Pause /><Camera /></div>
    </div>
  );
}
