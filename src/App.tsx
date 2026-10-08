import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Camera,
  Check,
  ChevronDown,
  Cloud,
  Clock3,
  Copy,
  Disc3,
  Download,
  Headphones,
  Images,
  Menu,
  Mic,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { PatchMap } from "./PatchMap";
import { ModuleLibrary } from "./ModuleLibrary";
import { ThemeLibrary } from "./ThemeLibrary";
import { SetPatches } from "./SetPatches";
import { PatchModuleOrder } from "./PatchModuleOrder";
import { cableEndpoint, cableOptions, orderedPatchFacades, reorderPatchModule, resolveCable } from "./sets";
import { MobileThemeFacades, MobileThemeSteps } from "./MobileThemeFlow";
import type { MobileThemeStep } from "./MobileThemeFlow";
import { GeminiConfiguration } from "./GeminiConfiguration";
import { KnobControl } from "./KnobControl";
import { prepareThemePreset } from "./library";
import { PresetAudio } from "./PresetAudio";
import { PatchMidiSettings } from "./PatchMidiSettings";
import { clearRemovedMasterClock, masterClockLabel } from "./patch";
import { MAX_MIDI_BYTES, validateMidiBytes } from "./midi";
import { clearCloudMediaSession, configureCloudWorkspaceMediaSession, deleteLocalData, deleteMedia, loadMedia, saveMedia } from "./storage";
import { GoogleLogin } from "@react-oauth/google";
import { Capacitor } from "@capacitor/core";
import {
  GOOGLE_CLIENT_ID,
  fetchCloudMedia,
  fetchCloudModuleMedia,
  listCloudThemes,
  listCloudModules,
  listCloudPresets,
  putCloudMedia,
  readCloudTheme,
  verifyCloudSession,
  workspaceMedia,
  writeCloudTheme,
  writeCloudModule,
  writeCloudPreset,
} from "./cloud";
import type { CloudIdentity, CloudTheme } from "./cloud";
import type { AudioAttachment, ControlDef, Facade, LibraryModule, MidiAttachment, ModulePreset, PatchCable, Workspace } from "./types";

const defaultControls: ControlDef[] = [
  { id: "frequency", label: "Frequency", hint: "Hauteur de résonance" },
  { id: "structure", label: "Structure", hint: "Organisation harmonique" },
  { id: "brightness", label: "Brightness", hint: "Timbre / éclat" },
  { id: "damping", label: "Damping", hint: "Amortissement" },
  { id: "position", label: "Position", hint: "Position dans la structure" },
];

function facadeControls(facade: Facade): ControlDef[] {
  return facade.controls ?? defaultControls;
}

function withLegacyOption(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options;
}

function makeId(): string {
  return crypto.randomUUID();
}

function createFacade(name: string, from?: Facade): Facade {
  return {
    id: makeId(),
    moduleId: from?.moduleId,
    presetId: from?.presetId,
    name,
    createdAt: new Date().toISOString(),
    values: from ? { ...from.values } : Object.fromEntries(defaultControls.map(({ id }) => [id, null])),
    moduleName: from?.moduleName,
    controls: from?.controls?.map((control) => ({ ...control })),
    jacks: from?.jacks?.map((jack) => ({ ...jack })),
    photoId: from?.moduleId ? from.photoId : undefined,
    model: from?.model ?? "",
    notes: from?.notes ?? "",
    cables: from ? from.cables.map((cable) => ({ ...cable, id: makeId() })) : [],
    recordings: [],
  };
}

const firstFacade = createFacade("Façade 1");
const firstPatchId = makeId();
const initialWorkspace: Workspace = {
  version: 3,
  set: { id: makeId(), name: "Mon SET 01", bpm: 90, key: "E majeur", midiFiles: [] },
  patches: [{ id: firstPatchId, name: "PATCH 1", notes: "", moduleInstanceIds: [firstFacade.id] }],
  activePatchId: firstPatchId,
  module: {
    name: "Rings",
    manufacturer: "Mutable Instruments",
    facades: [firstFacade],
    activeFacadeId: firstFacade.id,
  },
};

function safeFileName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "son";
}

function useMediaUrl(id: string | undefined, onError: (message: string) => void): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!id) return;
    let currentUrl = "";
    let active = true;
    loadMedia(id).then((blob) => {
      if (!active) return;
      if (!blob) throw new Error("Photo introuvable dans le cloud.");
      currentUrl = URL.createObjectURL(blob);
      setUrl(currentUrl);
    }).catch((reason: unknown) => {
      if (active) onError(reason instanceof Error ? reason.message : "Impossible de charger la photo du module.");
    });
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [id, onError]);
  return url;
}

function FacadeCard({
  facade,
  active,
  playing,
  disabled,
  onSelect,
  onPlay,
  onError,
}: {
  facade: Facade;
  active: boolean;
  playing: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onError: (message: string) => void;
}) {
  const url = useMediaUrl(facade.photoId, onError);
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

function AudioPlayer({ attachment, onRemove, disabled = false }: { attachment: AudioAttachment; onRemove: () => void; disabled?: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let currentUrl = "";
    let active = true;
    loadMedia(attachment.id).then((blob) => {
      if (!active) return;
      if (!blob) {
        setError("Fichier introuvable dans le cloud.");
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
      <button className="icon-button remove-audio" disabled={disabled} onClick={onRemove} aria-label="Supprimer cet enregistrement"><Trash2 size={17} /></button>
    </div>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [ready, setReady] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [cloudToken, setCloudToken] = useState("");
  const [cloudIdentity, setCloudIdentity] = useState<CloudIdentity | null>(null);
  const [cloudThemes, setCloudThemes] = useState<CloudTheme[]>([]);
  const [libraryModules, setLibraryModules] = useState<LibraryModule[]>([]);
  const [activePresets, setActivePresets] = useState<ModulePreset[]>([]);
  const [presetAudioBusy, setPresetAudioBusy] = useState(false);
  const [activeView, setActiveView] = useState<"theme" | "modules">("theme");
  const [themeListVisible, setThemeListVisible] = useState(true);
  const [mobile, setMobile] = useState(() => Capacitor.isNativePlatform() || window.matchMedia("(max-width: 680px)").matches);
  const [mobileStep, setMobileStep] = useState<MobileThemeStep>(1);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [refreshingCloudThemes, setRefreshingCloudThemes] = useState(false);
  const [cloudState, setCloudState] = useState<"signed-out" | "choosing" | "syncing" | "synced" | "error">("signed-out");
  const [cloudError, setCloudError] = useState("");
  const [toast, setToast] = useState("");
  const [cableDraft, setCableDraft] = useState<Omit<PatchCable, "id"> | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [audioSaving, setAudioSaving] = useState(false);
  const [facadeAdding, setFacadeAdding] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeTab, setActiveTab] = useState<"patch" | "sound">("patch");
  const [playingFacadeId, setPlayingFacadeId] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const midiInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const recordingFacadeIdRef = useRef("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef("");
  const cloudQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cloudTokenRef = useRef("");
  const cloudEnabledRef = useRef(false);
  const cloudRevisionRef = useRef(0);
  const uploadedMediaRef = useRef(new Set<string>());
  const nativeGoogleReadyRef = useRef(false);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const facades = workspace.module.facades;
  const activePatch = workspace.patches?.find((patch) => patch.id === workspace.activePatchId);
  const patchFacades = orderedPatchFacades(facades, activePatch);
  const activeFacade = patchFacades.find((facade) => facade.id === workspace.module.activeFacadeId) ?? patchFacades[0] ?? createFacade("Module non sélectionné");
  // Convention : toutes les sorties des modules du PATCH, seulement les entrées du module sélectionné.
  const patchOutputs = useMemo(() => cableOptions(facades.filter((facade) => activePatch?.moduleInstanceIds.includes(facade.id)), "output", workspace.module.name), [facades, activePatch, workspace.module.name]);
  const patchInputs = useMemo(() => cableOptions(facades, "input", workspace.module.name, activeFacade.id), [facades, activeFacade, workspace.module.name]);
  const controls = facadeControls(activeFacade);
  const activeIndex = facades.indexOf(activeFacade);
  const selectedPreset = activePresets.find((preset) => preset.id === activeFacade.presetId);
  const totalRecordings = facades.reduce((total, facade) => total + facade.recordings.length, 0);
  const navigationLocked = presetAudioBusy || recording || audioSaving || facadeAdding;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 680px)");
    const update = () => setMobile(Capacitor.isNativePlatform() || query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  function changeView(view: "theme" | "modules") {
    if (navigationLocked) {
      showToast("Arrête puis sauvegarde ou annule la prise audio avant de changer d'écran.");
      return;
    }
    setActiveView(view);
    if (view === "theme" && cloudEnabled) setThemeListVisible(false);
  }

  function showThemes() {
    if (navigationLocked) {
      showToast("Arrête puis sauvegarde ou annule la prise audio avant de changer d'écran.");
      return;
    }
    setActiveView("theme");
    setThemeListVisible(true);
    setMobileStep(1);
  }

  async function refreshCloudThemes() {
    if (!cloudToken || refreshingCloudThemes) return;
    setRefreshingCloudThemes(true);
    try {
      setCloudThemes(await listCloudThemes(cloudToken));
      showToast("Liste des SETS actualisée depuis le cloud.");
    } catch (reason) {
      handleCloudError(reason);
    } finally {
      setRefreshingCloudThemes(false);
    }
  }

  function changeMobileStep(step: MobileThemeStep) {
    if (navigationLocked) return;
    if (step === 1) { showThemes(); return; }
    if (!cloudEnabled || (step === 3 && !patchFacades.length)) return;
    setActiveView("theme");
    setThemeListVisible(false);
    setMobileStep(step);
    if (step === 3) setActiveTab("patch");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!cloudToken || !activeFacade.moduleId) {
      setActivePresets([]);
      return;
    }
    let cancelled = false;
    listCloudPresets(cloudToken, activeFacade.moduleId).then((presets) => {
      if (!cancelled) setActivePresets(presets);
    }).catch((reason: unknown) => {
      if (!cancelled) showToast(reason instanceof Error ? reason.message : "Impossible de charger les presets du module.");
    });
    return () => { cancelled = true; };
  }, [cloudToken, activeFacade.moduleId, showToast]);

  async function uploadWorkspaceMedia(snapshot: Workspace, token: string) {
    for (const item of workspaceMedia(snapshot)) {
      if (uploadedMediaRef.current.has(item.id)) continue;
      const blob = await loadMedia(item.id);
      if (!blob) throw new Error(`Média « ${item.id} » introuvable ; il n'a pas été synchronisé.`);
      await putCloudMedia(token, snapshot.set.id, item.id, blob);
      uploadedMediaRef.current.add(item.id);
    }
  }

  function handleCloudError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : "La synchronisation cloud a échoué.";
    setCloudError(message);
    setCloudState("error");
    if (typeof reason === "object" && reason !== null && "status" in reason && reason.status === 401) {
      cloudTokenRef.current = "";
      cloudEnabledRef.current = false;
      clearCloudMediaSession();
      setCloudToken("");
      setCloudIdentity(null);
      setCloudEnabled(false);
      setThemeListVisible(true);
      setCloudThemes([]);
      setLibraryModules([]);
    } else if (typeof reason === "object" && reason !== null && "status" in reason && reason.status === 409) {
      cloudEnabledRef.current = false;
      setCloudEnabled(false);
    }
    showToast(message);
  }

  function synchronizeCloud(snapshot: Workspace, token: string): Promise<void> {
    const pending = cloudQueueRef.current.then(async () => {
      if (cloudTokenRef.current !== token || !cloudEnabledRef.current) return;
      setCloudState("syncing");
      await uploadWorkspaceMedia(snapshot, token);
      const result = await writeCloudTheme(token, snapshot, cloudRevisionRef.current, false);
      cloudRevisionRef.current = result.revision;
      setCloudThemes((current) => current.map((item) => item.id === snapshot.set.id
        ? { ...item, set: result.workspace.set, revision: result.revision, updatedAt: result.updatedAt }
        : item));
      if (workspaceRef.current === snapshot) {
        setCloudState("synced");
        setCloudError("");
      }
    });
    cloudQueueRef.current = pending.catch(() => undefined);
    return pending;
  }

  async function completeGoogleSignIn(token: string) {
    setCloudState("syncing");
    setCloudError("");
    clearCloudMediaSession();
    try {
      const [identity, themes, modules] = await Promise.all([verifyCloudSession(token), listCloudThemes(token), listCloudModules(token)]);
      cloudTokenRef.current = token;
      cloudEnabledRef.current = false;
      uploadedMediaRef.current.clear();
      cloudRevisionRef.current = 0;
      setCloudToken(token);
      setCloudIdentity(identity);
      setCloudThemes(themes);
      setLibraryModules(modules);
      setCloudEnabled(false);
      setActiveView("theme");
      setCloudState("choosing");
    } catch (reason) {
      setCloudState("signed-out");
      handleCloudError(reason);
    }
  }

  async function signInNative() {
    try {
      const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
      if (!nativeGoogleReadyRef.current) {
        await GoogleSignIn.initialize({ clientId: GOOGLE_CLIENT_ID });
        nativeGoogleReadyRef.current = true;
      }
      const user = await GoogleSignIn.signIn();
      if (!user.idToken) throw new Error("Google n'a pas fourni d'ID token.");
      await completeGoogleSignIn(user.idToken);
    } catch (reason) {
      handleCloudError(reason);
    }
  }

  async function signOutCloud() {
    if (navigationLocked) { showToast("Termine l'opération en cours avant de te déconnecter."); return; }
    if (cloudEnabledRef.current && !await persistWorkspace(workspaceRef.current)) return;
    try {
      if (Capacitor.isNativePlatform()) {
        const { GoogleSignIn } = await import("@capawesome/capacitor-google-sign-in");
        await GoogleSignIn.signOut();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "La déconnexion Google native a échoué.";
      setCloudError(message);
      showToast(message);
    } finally {
      cloudTokenRef.current = "";
      cloudEnabledRef.current = false;
      uploadedMediaRef.current.clear();
      clearCloudMediaSession();
      setCloudToken("");
      setCloudIdentity(null);
      setCloudThemes([]);
      setLibraryModules([]);
      setCloudEnabled(false);
      setCloudState("signed-out");
    }
  }

  async function openCloudTheme(themeId: string) {
    if (navigationLocked) { showToast("Termine la prise audio avant de changer de SET."); return; }
    if (!cloudToken) return;
    if (cloudEnabledRef.current && !await persistWorkspace(workspaceRef.current)) return;
    cloudEnabledRef.current = false;
    setCloudEnabled(false);
    setCloudState("syncing");
    setCloudError("");
    uploadedMediaRef.current.clear();
    try {
      const result = await readCloudTheme(cloudToken, themeId);
      configureCloudWorkspaceMediaSession(
        () => workspaceRef.current,
        (id) => fetchCloudMedia(cloudToken, themeId, id),
        (moduleId, id) => fetchCloudModuleMedia(cloudToken, moduleId, id),
      );
      workspaceMedia(result.workspace).forEach((item) => uploadedMediaRef.current.add(item.id));
      cloudRevisionRef.current = result.revision;
      setWorkspace(result.workspace);
      setReady(true);
      cloudEnabledRef.current = true;
      setCloudEnabled(true);
      setCloudState("synced");
      setThemeListVisible(false);
      setActiveView("theme");
      setMobileStep(2);
      showToast(`« ${result.workspace.set.name} » chargé depuis le cloud.`);
    } catch (reason) {
      uploadedMediaRef.current.clear();
      handleCloudError(reason);
    }
  }

  async function createCloudTheme() {
    if (navigationLocked) { showToast("Termine la prise audio avant de créer un SET."); return; }
    if (!cloudToken) return;
    if (cloudEnabledRef.current && !await persistWorkspace(workspaceRef.current)) return;
    const token = cloudToken;
    const patchId = makeId();
    const fresh: Workspace = {
      ...initialWorkspace,
      set: { ...initialWorkspace.set, id: makeId(), name: "Mon SET 01" },
      patches: [{ id: patchId, name: "PATCH 1", notes: "", moduleInstanceIds: [] }],
      activePatchId: patchId,
      module: {
        ...initialWorkspace.module,
        name: "",
        manufacturer: "",
        facades: [],
        activeFacadeId: "",
      },
    };
    cloudEnabledRef.current = false;
    setCloudEnabled(false);
    setCloudState("syncing");
    setCloudError("");
    try {
      const saved = await writeCloudTheme(token, fresh, 0, true);
      configureCloudWorkspaceMediaSession(
        () => workspaceRef.current,
        (id) => fetchCloudMedia(token, fresh.set.id, id),
        (moduleId, id) => fetchCloudModuleMedia(token, moduleId, id),
      );
      cloudRevisionRef.current = saved.revision;
      setWorkspace(saved.workspace);
      setReady(true);
      cloudEnabledRef.current = true;
      setCloudEnabled(true);
      setCloudThemes((current) => [...current, {
        id: fresh.set.id, set: saved.workspace.set, revision: saved.revision, updatedAt: saved.updatedAt,
      }]);
      setThemeListVisible(false);
      setActiveView("theme");
      setMobileStep(2);
      setCloudState("synced");
      showToast(`« ${fresh.set.name} » créé dans le cloud.`);
    } catch (reason) {
      handleCloudError(reason);
      try {
        setCloudThemes(await listCloudThemes(token));
      } catch (refreshError) {
        setCloudError(refreshError instanceof Error ? refreshError.message : "Impossible d'actualiser les SETS cloud.");
      }
    }
  }

  const persistWorkspace = useCallback((snapshot: Workspace): Promise<boolean> => {
    if (!cloudTokenRef.current || !cloudEnabledRef.current) return Promise.resolve(false);
    return synchronizeCloud(snapshot, cloudTokenRef.current).then(() => true).catch((reason: unknown) => {
      handleCloudError(reason);
      return false;
    });
  }, []);

  async function saveActiveFacade() {
    if (!ready || manualSaving) return;
    const snapshot = workspace;
    const facadeName = activeFacade.name;
    setManualSaving(true);
    try {
      if (await persistWorkspace(snapshot)) {
        showToast(`« ${facadeName} » sauvegardée dans le cloud.`);
      }
    } finally {
      setManualSaving(false);
    }
  }

  async function saveActivePreset() {
    if (presetAudioBusy) { showToast("Sauvegarde ou annule la prise audio avant d'enregistrer les réglages."); return; }
    if (!activeFacade.moduleId || !cloudToken) return;
    const existing = activePresets.find((preset) => preset.id === activeFacade.presetId);
    const name = window.prompt("Nom du preset (un autre nom crée un nouveau preset)", existing?.name ?? "");
    if (!name?.trim()) return;
    const preset = prepareThemePreset(name, activeFacade.values, activeFacade.notes, existing);
    try {
      const saved = await writeCloudPreset(cloudToken, activeFacade.moduleId, preset);
      setActivePresets((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setWorkspace((current) => ({
        ...current,
        module: {
          ...current.module,
          facades: current.module.facades.map((facade) => facade.id === activeFacade.id
            ? { ...facade, presetId: saved.id }
            : facade),
        },
      }));
      showToast(`Preset « ${saved.name} » enregistré dans le module.`);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Impossible d'enregistrer le preset.");
    }
  }

  function applyActivePreset(presetId: string) {
    if (presetAudioBusy) { showToast("Sauvegarde ou annule la prise audio avant de changer de preset."); return; }
    const preset = activePresets.find((item) => item.id === presetId);
    if (!preset) return;
    updateFacade(activeFacade.id, (facade) => ({
      ...facade, presetId: preset.id, values: { ...preset.values }, notes: preset.notes,
    }));
  }

  useEffect(() => {
    deleteLocalData().then(() => {
      setReady(true);
    }).catch((reason: unknown) => {
      handleCloudError(reason);
    });
  }, [showToast]);

  useEffect(() => {
    if (!ready || !cloudToken || !cloudEnabled) return;
    setCloudState("syncing");
    const timer = window.setTimeout(() => {
      void synchronizeCloud(workspace, cloudToken).catch(handleCloudError);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [workspace, ready, cloudToken, cloudEnabled]);

  useEffect(() => {
    if (cloudState !== "syncing") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [cloudState]);

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
    if (navigationLocked) { showToast("Termine l'opération en cours avant de changer de façade."); return; }
    if (id === activeFacade.id) return;
    stopPreview();
    setCableDraft(null);
    setWorkspace((current) => ({
      ...current, activePatchId: current.patches?.find((patch) => patch.moduleInstanceIds.includes(id))?.id ?? current.activePatchId,
      module: { ...current.module, activeFacadeId: id },
    }));
  }

  function selectPatch(id: string) {
    if (navigationLocked) return;
    stopPreview();
    setCableDraft(null);
    setWorkspace((current) => ({
      ...current, activePatchId: id,
      module: { ...current.module, activeFacadeId: current.patches?.find((patch) => patch.id === id)?.moduleInstanceIds[0] ?? "" },
    }));
  }

  function movePatchModule(id: string, targetId: string, position: "before" | "after") {
    if (navigationLocked || !activePatch) return;
    setWorkspace((current) => reorderPatchModule(current, activePatch.id, id, targetId, position));
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
        showToast("Fichier audio introuvable dans le cloud.");
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

  function duplicateFacade() {
    if (presetAudioBusy) { showToast("Sauvegarde ou annule la prise audio avant de dupliquer le module."); return; }
    stopPreview();
    const facade = createFacade(`${activeFacade.name} (copie)`, activeFacade);
    facade.cables = facade.cables.map((cable) => cable.destinationInstanceId
      ? { ...cable, destinationInstanceId: facade.id } : cable);
    setWorkspace((current) => ({
      ...current,
      patches: current.patches?.map((patch) => patch.id === current.activePatchId
        ? { ...patch, moduleInstanceIds: [...patch.moduleInstanceIds, facade.id] } : patch),
      module: { ...current.module, facades: [...current.module.facades, facade], activeFacadeId: facade.id },
    }));
    showToast("Réglages copiés dans une nouvelle façade. Tu peux lui associer un son.");
    window.setTimeout(() => document.querySelector(".facade-card.active")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 50);
  }

  async function removeFacade() {
    if (presetAudioBusy) { showToast("Sauvegarde ou annule la prise audio avant de retirer le module."); return; }
    if (facades.length === 0) return;
    const count = activeFacade.recordings.length;
    if (!window.confirm(`Supprimer « ${activeFacade.name} » ?${count > 0 ? ` Ses ${count} son(s) seront aussi supprimés.` : ""}`)) return;
    stopPreview();
    const removed = activeFacade;
    const fallback = patchFacades.find((facade) => facade.id !== removed.id);
    setWorkspace((current) => ({
      ...current,
      set: clearRemovedMasterClock(current, removed.id),
      patches: current.patches?.map((patch) => ({ ...patch, moduleInstanceIds: patch.moduleInstanceIds.filter((id) => id !== removed.id) })),
      module: {
        ...current.module,
        facades: current.module.facades.filter((facade) => facade.id !== removed.id).map((facade) => ({
          ...facade, cables: facade.cables.filter((cable) => cable.sourceInstanceId !== removed.id && cable.destinationInstanceId !== removed.id),
        })),
        activeFacadeId: fallback?.id ?? "",
      },
    }));
    await deleteMedia([...(removed.photoId && !removed.moduleId ? [removed.photoId] : []), ...removed.recordings.map((item) => item.id)]).catch(() => undefined);
    showToast(`« ${removed.name} » supprimée.${workspace.set.masterClockFacadeId === removed.id ? " Choisis un nouveau MASTER CLOCK." : ""}`);
  }

  function addRecordingTo(facadeId: string, attachment: AudioAttachment) {
    updateFacade(facadeId, (facade) => ({ ...facade, recordings: [attachment, ...facade.recordings] }));
  }

  function updateSet<K extends keyof Workspace["set"]>(field: K, value: Workspace["set"][K]) {
    setWorkspace((current) => ({ ...current, set: { ...current.set, [field]: value } }));
  }

  async function saveLibraryModule(value: LibraryModule) {
    const token = cloudTokenRef.current;
    if (!token) throw new Error("Connecte-toi à Google avant d'enregistrer un module.");
    const module = await writeCloudModule(token, value);
    setLibraryModules((current) => [module, ...current.filter((item) => item.id !== module.id)]);
    setWorkspace((current) => ({
      ...current,
      module: {
        ...current.module,
        name: current.module.facades.some((facade) => facade.moduleId === module.id) ? module.name : current.module.name,
        manufacturer: current.module.facades.some((facade) => facade.moduleId === module.id) ? module.manufacturer : current.module.manufacturer,
        facades: current.module.facades.map((facade) => facade.moduleId === module.id ? {
          ...facade,
          moduleName: module.name,
          controls: module.controls,
          jacks: module.jacks,
          photoId: module.photoId,
          model: module.model,
          name: facade.name === libraryModules.find((item) => item.id === module.id)?.name ? module.name : facade.name,
        } : facade),
      },
    }));
  }

  async function addLibraryModule(value: LibraryModule, preset?: ModulePreset) {
    if (navigationLocked || !cloudEnabled) { showToast("Ouvre un SET et termine la prise audio avant d'ajouter un module."); return; }
    const token = cloudTokenRef.current;
    if (!token) {
      showToast("Connecte-toi à Google avant d'ajouter un module au PATCH.");
      return;
    }
    let module: LibraryModule;
    setFacadeAdding(true);
    try {
      module = await writeCloudModule(token, value);
      setLibraryModules((current) => [module, ...current.filter((item) => item.id !== module.id)]);
    } catch (reason) {
      setFacadeAdding(false);
      showToast(reason instanceof Error ? reason.message : "Impossible d'enregistrer le module.");
      return;
    }
    const instance: Facade = {
      ...createFacade(module.name),
      moduleId: module.id,
      presetId: preset?.id,
      moduleName: module.name,
      controls: module.controls.map((control) => ({ ...control })),
      jacks: module.jacks.map((jack) => ({ ...jack })),
      photoId: module.photoId,
      model: module.model,
      values: preset ? { ...preset.values } : Object.fromEntries(module.controls.map(({ id }) => [id, null])),
      notes: preset?.notes ?? "",
    };
    setWorkspace((current) => ({
      ...current,
      patches: current.patches?.map((patch) => patch.id === current.activePatchId
        ? { ...patch, moduleInstanceIds: [...patch.moduleInstanceIds, instance.id] } : patch),
      module: {
        ...current.module,
        name: module!.name,
        manufacturer: module!.manufacturer,
        facades: [...current.module.facades, instance],
        activeFacadeId: instance.id,
      },
    }));
    setActiveView("theme");
    setThemeListVisible(false);
    setFacadeAdding(false);
    showToast(`« ${module.name} » ajouté au PATCH.`);
  }

  async function importMidi(file?: File) {
    if (!file) return;
    try {
      if (!/\.midi?$/i.test(file.name)) throw new Error("Choisis un fichier .mid ou .midi.");
      if (file.size > MAX_MIDI_BYTES) throw new Error("Le fichier MIDI dépasse la limite de 10 Mio.");
      validateMidiBytes(new Uint8Array(await file.arrayBuffer()));
      const attachment: MidiAttachment = {
        id: makeId(), name: file.name, mimeType: "audio/midi", sizeBytes: file.size, createdAt: new Date().toISOString(),
      };
      await saveMedia(attachment.id, new Blob([file], { type: attachment.mimeType }));
      setWorkspace((current) => ({ ...current, set: { ...current.set, midiFiles: [...(current.set.midiFiles ?? []), attachment] } }));
      showToast("Fichier MIDI associé au SET ; synchronisation cloud en cours.");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Impossible d'importer le fichier MIDI.");
    }
  }

  async function downloadMidi(attachment: MidiAttachment) {
    let url = "";
    try {
      const blob = await loadMedia(attachment.id);
      if (!blob) throw new Error("Fichier MIDI introuvable dans le cloud.");
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.click();
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Impossible de télécharger le fichier MIDI.");
    } finally {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function removeMidi(id: string) {
    if (!window.confirm("Retirer ce fichier MIDI du SET ?")) return;
    const snapshot = workspaceRef.current;
    const next = { ...snapshot, set: { ...snapshot.set, midiFiles: (snapshot.set.midiFiles ?? []).filter((file) => file.id !== id) } };
    if (!await persistWorkspace(next)) {
      return;
    }
    setWorkspace((current) => ({ ...current, set: { ...current.set, midiFiles: (current.set.midiFiles ?? []).filter((file) => file.id !== id) } }));
    try {
      await deleteMedia([id]);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Le fichier MIDI n'a pas pu être effacé du stockage.");
    }
  }

  function updateFacadeField(field: "notes" | "name", value: string) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, [field]: value }));
  }

  function updateControl(id: string, value: number) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, values: { ...facade.values, [id]: value } }));
  }

  function updateCable(id: string, update: Partial<Omit<PatchCable, "id">>) {
    updateFacade(activeFacade.id, (facade) => ({
      ...facade,
      cables: facade.cables.map((cable) => cable.id === id
        ? { ...resolveCable({
          ...cable,
          source: cableEndpoint(cable, "source", facades, workspace.module.name),
          destination: cableEndpoint(cable, "destination", facades, workspace.module.name),
          ...update,
        }, facades, workspace.module.name), id: cable.id } : cable),
    }));
  }

  function startCable() {
    setCableDraft({ source: "", destination: "", color: "pink" });
  }

  function validateCable() {
    if (!cableDraft?.source || !cableDraft.destination) return;
    const cable: PatchCable = { id: makeId(), ...resolveCable(cableDraft, facades, workspace.module.name) };
    updateFacade(activeFacade.id, (facade) => ({ ...facade, cables: [...facade.cables, cable] }));
    setCableDraft(null);
    showToast("Câble validé.");
  }

  function removeCable(id: string) {
    updateFacade(activeFacade.id, (facade) => ({ ...facade, cables: facade.cables.filter((cable) => cable.id !== id) }));
  }

  async function attachAudioFile(file?: File) {
    if (!file) return;
    if (navigationLocked) { showToast("Termine l'opération en cours avant d'importer un son."); return; }
    if (!file.type.startsWith("audio/") && !/\.(m4a|wav|mp3|aac|ogg|flac)$/i.test(file.name)) {
      showToast("Choisis un fichier audio (M4A, WAV, MP3, etc.).");
      return;
    }
    const id = makeId();
    setAudioSaving(true);
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
    } finally {
      setAudioSaving(false);
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
    if (navigationLocked) { showToast("Termine d'abord l'opération en cours."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast("La capture audio n'est pas disponible dans ce navigateur.");
      return;
    }
    setAudioSaving(true);
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
        setAudioSaving(true);
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
        }).finally(() => {
          setAudioSaving(false);
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
      setActiveTab("patch");
      await refreshAudioInputs();
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      showToast(reason instanceof Error ? `Capture refusée : ${reason.message}` : "Capture audio impossible. Vérifie l'accès au microphone.");
    } finally {
      setAudioSaving(false);
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

  const statusText = cloudState === "synced" ? "Synchronisé dans le cloud"
    : cloudState === "syncing" ? "Synchronisation…"
      : cloudState === "error" ? "Erreur cloud"
        : "Connecté · choisir un SET cloud";

  if (!cloudToken) {
    return (
      <main className="cloud-gate">
        <section className="cloud-gate-card">
          <div className="cloud-gate-marketing">
            <a className="brand" href="#" aria-label="Analog Memory">
              <span className="brand-mark"><Waves size={19} /></span>
              <span>analog<span className="brand-light">memory</span><small>STUDIO ARCHIVE</small></span>
            </a>
            <div className="cloud-gate-copy">
              <span className="eyebrow"><Cloud size={14} /> TON STUDIO ANALOGIQUE, ENFIN MÉMORISÉ</span>
              <h1>Retrouve ton son. Pas juste le souvenir du son.</h1>
              <p>Centralise tes modules, tes presets et tes patches pour reprendre une session exactement là où tu l’as laissée.</p>
            </div>
            <div className="cloud-gate-features">
              <div><SlidersHorizontal size={16} /><span><strong>Ta bibliothèque de modules</strong><small>Façades, contrôles, entrées et sorties au même endroit.</small></span></div>
              <div><Save size={16} /><span><strong>Presets et PATCHES retrouvés</strong><small>Les réglages de tes appareils, organisés par morceau.</small></span></div>
              <div><Cloud size={16} /><span><strong>Avec toi en studio</strong><small>Retrouve tes archives sur le Web et Android.</small></span></div>
            </div>
          </div>
          <div className="cloud-gate-auth">
            <span className="eyebrow">ESPACE PERSONNEL</span>
            <h2>Entre dans ton studio</h2>
            <p className="cloud-gate-auth-copy">Connecte-toi avec Google pour ouvrir ou créer tes SETS.</p>
          {Capacitor.isNativePlatform()
            ? <button className="outline-button" onClick={() => void signInNative()}><Cloud size={15} /> Se connecter avec Google</button>
            : <GoogleLogin onSuccess={(response) => {
              if (response.credential) void completeGoogleSignIn(response.credential);
              else handleCloudError(new Error("Google n'a pas renvoyé d'ID token."));
            }} onError={() => handleCloudError(new Error("La connexion Google a échoué. Vérifie le client OAuth et les origines autorisées."))} theme="filled_black" shape="pill" text="signin_with" />}
          {cloudState === "syncing" && <p className="cloud-gate-progress" role="status">Connexion ou synchronisation en cours…</p>}
          {cloudError && <p className="cloud-error" role="alert">{cloudError}</p>}
            <p className="cloud-gate-note">Connexion Internet requise · Données privées dans ton compte Google.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className={`app-shell${mobile ? " mobile-capture-app" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Analog Memory">
          <span className="brand-mark"><Waves size={19} /></span>
          <span>analog<span className="brand-light">memory</span><small>STUDIO ARCHIVE</small></span>
        </a>
        <div className="topbar-right">
          {!mobile && <button className="outline-button configuration-button" aria-label="Configuration" title="Configuration" onClick={() => setConfigurationOpen(true)} disabled={navigationLocked}><Settings size={17} /><span>Configuration</span></button>}
          <div className={`save-indicator ${cloudState === "error" ? "error" : cloudState === "syncing" ? "saving" : "saved"}`}><span />{statusText}</div>
          {cloudIdentity && <button className="profile-chip" disabled={navigationLocked} onClick={() => void signOutCloud()} aria-label={`Déconnecter ${cloudIdentity.email ?? "le compte Google"}`} title={cloudIdentity.email}><span>{(cloudIdentity.name ?? cloudIdentity.email ?? "G").slice(0, 2).toUpperCase()}</span></button>}
        </div>
      </header>
      {configurationOpen && <GeminiConfiguration key={cloudToken} token={cloudToken} onClose={() => setConfigurationOpen(false)} />}

      {!ready && !cloudError && <p className="cloud-gate-progress workspace-feedback" role="status">Suppression de l’ancien stockage local…</p>}
      {cloudError && <p className="cloud-error workspace-feedback" role="alert">{cloudError}</p>}

      <div className="layout">
        <aside className="sidebar">
          <div className="workspace-label">ESPACE DE TRAVAIL</div>
          <button className={`nav-item ${activeView === "theme" ? "active" : ""}`} onClick={showThemes}><Disc3 size={18} /><span>Mes SETS</span><span className="nav-count">{String(cloudThemes.length).padStart(2, "0")}</span></button>
          <button className={`nav-item ${activeView === "modules" ? "active" : ""}`} onClick={() => changeView("modules")}><SlidersHorizontal size={18} /><span>Modules</span><span className="nav-count">{String(libraryModules.length).padStart(2, "0")}</span></button>
          <div className="sidebar-separator" />
          <div className="sidebar-section-title"><span>SETS RÉCENTS</span>          <button className="tiny-icon" aria-label="Ajouter un SET" onClick={() => void createCloudTheme()} disabled={!ready || cloudState === "syncing"}><Plus size={15} /></button></div>
          {cloudEnabled && <button className="set-nav active-set" onClick={() => changeView("theme")}><span className="set-dot" /><span><strong>{workspace.set.name || "Sans titre"}</strong><small>{workspace.set.bpm} BPM · {workspace.set.key}</small></span><ChevronDown size={15} /></button>}
          <div className="sidebar-bottom">
            <div className="local-card"><span className="local-icon"><Cloud size={16} /></span><div><strong>Cloud connecté</strong><small>Synchronisé sur vos appareils</small></div></div>
            <span className="version">STUDIO · V1.3</span>
            <small className="sidebar-copyright">Copyright Max Patissier 2026</small>
          </div>
        </aside>

        {activeView === "modules" ? (
          <ModuleLibrary token={cloudToken} modules={libraryModules} onSave={saveLibraryModule} onAddToTheme={addLibraryModule} onBackToTheme={() => changeView("theme")} showToast={showToast} themeAvailable={cloudEnabled} onAudioBusyChange={setPresetAudioBusy} />
        ) : <><div className="theme-library-container" hidden={cloudEnabled && !themeListVisible}>
          {mobile && <div className="mobile-flow-intro"><MobileThemeSteps step={1} themeAvailable={cloudEnabled} hasFacades={patchFacades.length > 0} disabled={navigationLocked} onStep={changeMobileStep} /><h1>Choisis un SET</h1><p>Ouvre un morceau ou crée-en un pour garder tes PATCHES et tes sons.</p></div>}
          <ThemeLibrary themes={cloudThemes} activeId={cloudEnabled ? workspace.set.id : undefined} disabled={!ready || cloudState === "syncing" || navigationLocked} refreshing={refreshingCloudThemes} onOpen={(id) => void openCloudTheme(id)} onCreate={() => void createCloudTheme()} onRefresh={() => void refreshCloudThemes()} />
        </div>{cloudEnabled && !themeListVisible && <main className="main-content">
          {mobile && <>
            <MobileThemeSteps step={mobileStep} themeAvailable={cloudEnabled} hasFacades={patchFacades.length > 0} disabled={navigationLocked} onStep={changeMobileStep} />
            <label className="mobile-theme-name">Mon SET<input aria-label="Nom du SET" value={workspace.set.name} disabled={navigationLocked} onChange={(event) => updateSet("name", event.target.value)} /></label>
            <p className={`mobile-sync-status${cloudState === "error" ? " error-text" : ""}`} role="status">{statusText}</p>
            {mobileStep === 2 && <MobileThemeFacades modules={libraryModules} facades={patchFacades} activeId={activeFacade.id} disabled={navigationLocked}
              onAdd={addLibraryModule} onSelect={selectFacade} onRemove={() => void removeFacade()} onContinue={() => changeMobileStep(3)} />}
          </>}
          {!mobile && <>
          <section className="set-heading">
            <div className="set-title-area">
              <span className="eyebrow"><span className="live-dot" /> SESSION EN COURS</span>
              <h1 className="set-title-heading">
                <input className="set-name" aria-label="Nom du SET" maxLength={500} placeholder="Sans titre"
                  value={workspace.set.name} disabled={navigationLocked} onChange={(event) => updateSet("name", event.target.value)} />
              </h1>
            </div>
            <button className="primary-button save-patch-button" onClick={() => changeView("modules")} disabled={navigationLocked}><SlidersHorizontal size={16} /> Ajouter un module</button>
          </section>

          <details className="theme-details">
            <summary>Informations musicales et fichiers MIDI</summary>
          <section className="set-meta">
            <label className="meta-field"><span className="meta-icon"><Music2 size={16} /></span><span className="meta-label">TEMPO</span><input type="number" min="1" max="999" value={workspace.set.bpm} onChange={(event) => updateSet("bpm", Number(event.target.value))} aria-label="Tempo en BPM" /><span className="meta-unit">BPM</span></label>
            <label className="meta-field"><span className="meta-icon"><Waves size={16} /></span><span className="meta-label">TONALITÉ</span><select value={workspace.set.key} onChange={(event) => updateSet("key", event.target.value)} aria-label="Tonalité">{["C majeur","C# majeur","D majeur","D# majeur","E majeur","F majeur","F# majeur","G majeur","G# majeur","A majeur","A# majeur","B majeur","A mineur","E mineur"].map((key) => <option key={key}>{key}</option>)}</select><ChevronDown size={14} className="select-chevron" /></label>
            <div className="meta-field module-meta"><span className="meta-icon"><Images size={16} /></span><span className="meta-label">MODULES</span><strong>{facades.length.toString().padStart(2, "0")} <small>dans ce SET</small></strong></div>
            <div className="meta-field capture-meta"><span className="meta-icon"><Headphones size={16} /></span><span className="meta-label">AUDIO</span><strong>{totalRecordings.toString().padStart(2, "0")} <small>prises</small></strong></div>
          </section>

          <section className="clock-config" aria-label="Configuration MASTER CLOCK">
            <div className="theme-fields">
              <label>MASTER CLOCK · appareil maître
                <select aria-label="Appareil MASTER CLOCK" value={workspace.set.masterClockFacadeId ?? ""} onChange={(event) => updateSet("masterClockFacadeId", event.target.value || undefined)}>
                  <option value="">Non défini</option>
                  {facades.map((facade) => <option key={facade.id} value={facade.id}>{masterClockLabel(facades, facade.id, workspace.module.name)}</option>)}
                </select>
              </label>
            </div>
            <p>Tempo de référence : {workspace.set.bpm} BPM. Coche « Diffuser MASTER CLOCK » sur chaque liaison qui transmet l'horloge, y compris les relais MIDI THRU / routeurs. L'horloge MIDI est indépendante du canal.</p>
            <p>Configuration mémorisée uniquement : aucun signal MIDI n'est envoyé par l'application.</p>
            {!workspace.set.masterClockFacadeId && facades.some((facade) => facade.cables.some((cable) => cable.carriesClock)) && <p className="error-text" role="alert">Des lignes diffusent l'horloge, mais aucun MASTER CLOCK n'est défini. Sélectionne l'appareil maître.</p>}
          </section>

            <div className="theme-fields">
              {([
                ["artist", "Artiste / compositeur"],
                ["musicians", "Musiciens"],
                ["project", "Projet / album"],
                ["genre", "Genre"],
                ["timeSignature", "Signature rythmique (ex. 4/4)"],
                ["abletonProject", "Référence du projet Ableton (.als, chemin ou lien)"],
                ["abletonTrack", "Piste Ableton"],
                ["abletonScene", "Scène / clip Ableton"],
                ["tags", "Tags (séparés par des virgules)"],
              ] as const).map(([field, label]) => <label key={field}>{label}<input maxLength={500} value={workspace.set[field] ?? ""} onChange={(event) => updateSet(field, event.target.value)} /></label>)}
              <label>État du SET<select value={workspace.set.status ?? "idea"} onChange={(event) => {
                const value = event.target.value;
                if (value === "idea" || value === "in-progress" || value === "finished") updateSet("status", value);
              }}><option value="idea">Idée</option><option value="in-progress">En cours</option><option value="finished">Terminé</option></select></label>
              <label className="theme-notes">Notes du SET<textarea maxLength={10000} rows={3} value={workspace.set.notes ?? ""} onChange={(event) => updateSet("notes", event.target.value)} /></label>
            </div>
            <div className="midi-files">
              <button className="outline-button" onClick={() => midiInputRef.current?.click()} disabled={!ready}><Upload size={14} /> Joindre un fichier MIDI</button>
              <input ref={midiInputRef} type="file" accept=".mid,.midi,audio/midi,audio/x-midi" hidden onChange={(event) => { void importMidi(event.target.files?.[0]); event.target.value = ""; }} />
              <p>Fichiers .mid / .midi, 10 Mio maximum. Conservation et téléchargement, sans lecture ni envoi vers les synthétiseurs.</p>
              {(workspace.set.midiFiles ?? []).map((file) => <div className="midi-file" key={file.id}><span>{file.name} · {Math.ceil(file.sizeBytes / 1024)} Kio</span><button className="icon-button" aria-label={`Télécharger ${file.name}`} onClick={() => void downloadMidi(file)}><Download size={16} /></button><button className="icon-button" aria-label={`Retirer ${file.name}`} onClick={() => void removeMidi(file.id)}><Trash2 size={16} /></button></div>)}
            </div>
          </details>

          </>}
          <SetPatches workspace={workspace} disabled={navigationLocked} onSelect={selectPatch} onChange={(next) => { stopPreview(); setCableDraft(null); setWorkspace(next); }} />
          {!mobile && patchFacades.length === 0 && <section className="module-empty-theme">
            <SlidersHorizontal size={24} />
            <h2>Ce PATCH n’a pas encore de module</h2>
            <p>Choisis un module dans ta bibliothèque, ajoute-le à ce PATCH puis configure ses réglages, câbles et sons.</p>
            <button className="primary-button" onClick={() => changeView("modules")}><Plus size={15} /> Ouvrir la bibliothèque</button>
          </section>}
          {patchFacades.length > 0 && <>
          {!mobile && <>
          <section className="facade-section">
            <div className="section-heading">
              <div><span className="eyebrow">{patchFacades.length} MODULE{patchFacades.length > 1 ? "S" : ""} DANS CE PATCH</span><h2>Modules du PATCH</h2></div>
              <button className="text-button" onClick={duplicateFacade} disabled={navigationLocked}><Copy size={14} /> Dupliquer les réglages</button>
            </div>
            <p className="facade-help">Sélectionne un module pour retrouver ses réglages, ses câbles et ses sons. Glisse sa poignée pour changer l'ordre dans ce PATCH.</p>
            <PatchModuleOrder key={activePatch?.id} facades={patchFacades} disabled={navigationLocked} onMove={movePatchModule}
              renderFacade={(facade) => <FacadeCard facade={facade} active={facade.id === activeFacade.id} playing={playingFacadeId === facade.id} disabled={navigationLocked} onSelect={() => selectFacade(facade.id)} onPlay={() => void togglePreview(facade)} onError={showToast} />}>
              <button className="facade-add" onClick={() => changeView("modules")} disabled={recording}><Plus size={20} /><strong>Ajouter un module</strong><small>Depuis ta bibliothèque</small></button>
            </PatchModuleOrder>
          </section>

          <section className="module-section">
            <div className="section-heading">
              <div><span className="eyebrow">FAÇADE {(activeIndex + 1).toString().padStart(2, "0")} / {facades.length.toString().padStart(2, "0")}</span><h2>Réglages de la façade</h2></div>
              <button className="text-button danger-text" onClick={() => void removeFacade()} disabled={navigationLocked}><Trash2 size={14} /> Retirer du PATCH</button>
            </div>

            <article className="module-card">
              <div className="module-card-top">
                <div className="module-identity">
                  <span className="module-avatar"><Waves size={20} /></span>
                  <span><input className="facade-name" aria-label="Nom du module" value={activeFacade.name} readOnly={!!activeFacade.moduleId} onChange={(event) => updateFacadeField("name", event.target.value)} /><small>{activeFacade.moduleName ?? workspace.module.name} <span>·</span> {workspace.module.manufacturer}</small></span>
                </div>
                {activeFacade.moduleId && <label className="module-preset-select">Preset du module
                  <select value={activeFacade.presetId ?? ""} disabled={presetAudioBusy || recording} onChange={(event) => applyActivePreset(event.target.value)}>
                    <option value="">Réglages libres</option>
                    {activePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </select>
                </label>}
                <span className="module-state"><span /> {dateLabel(activeFacade.createdAt).toUpperCase()}</span>
              </div>

              <div className="facade-save-bar">
                <div className="facade-save-feedback">
                  <span className={`save-indicator ${cloudState === "error" ? "error" : cloudState === "syncing" ? "saving" : "saved"}`} role="status"><span />{statusText}</span>
                  <small>Sauvegarde automatique dans le cloud</small>
                </div>
                <button className="primary-button facade-save-button" onClick={() => void saveActiveFacade()} disabled={!ready || manualSaving} aria-label="Sauvegarder la façade" aria-busy={manualSaving}>
                  <Save size={16} />{manualSaving ? "Sauvegarde…" : "SAVE"}
                </button>
                {activeFacade.moduleId && <button className="outline-button" onClick={() => void saveActivePreset()}><Save size={14} /> Enregistrer le preset</button>}
              </div>

              {activeFacade.moduleId && selectedPreset && <div className="theme-preset-audio">
                <PresetAudio key={`${activeFacade.moduleId}-${selectedPreset.id}`} token={cloudToken} moduleId={activeFacade.moduleId} preset={selectedPreset} showToast={showToast} disabled={recording} onBusyChange={setPresetAudioBusy} onSaved={(saved) => setActivePresets((current) => current.map((item) => item.id === saved.id ? saved : item))} />
              </div>}

              <div className="theme-preset-controls">
                <div className="control-area">
                  <div className="controls-heading"><div><span className="eyebrow">RÉGLAGES DU PANNEAU</span><h3>Position des contrôles</h3></div><span className="control-progress">{knownControls}/{controls.length} saisis</span></div>
                  {controls.length > 0 ? <p className="potentiometer-scale-note">Échelle mécanique : 7 h = 0 % · 12 h = 50 % · 5 h = 100 %.</p>
                    : <p className="potentiometer-scale-note">Aucun potentiomètre ou curseur sur cette façade.</p>}
                  <div className="knob-grid">{controls.map((control) => <KnobControl key={control.id} control={control} value={activeFacade.values[control.id] ?? null} onChange={(value) => updateControl(control.id, value)} />)}</div>
                </div>
              </div>

              <div className="cable-section">
                <div className="subsection-heading"><div><span className="subsection-icon"><Zap size={15} /></span><span><strong>Câblage du patch</strong><small>Entrées et sorties reliées pour ce son</small></span></div><button className="outline-button" onClick={startCable} disabled={!!cableDraft}><Plus size={15} /> Ajouter un câble</button></div>
                {cableDraft && <div className="cable-draft">
                  <div className="cable-row">
                    <span className={`cable-color ${cableDraft.color}`} />
                    <select aria-label="Nouvelle sortie" value={cableDraft.source} onChange={(event) => setCableDraft({ ...cableDraft, source: event.target.value })}>
                      <option value="">Sortie…</option>
                      {patchOutputs.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <span className="cable-arrow">→</span>
                    <select aria-label="Nouvelle entrée" value={cableDraft.destination} onChange={(event) => setCableDraft({ ...cableDraft, destination: event.target.value })}>
                      <option value="">Entrée…</option>
                      {patchInputs.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select aria-label="Couleur du nouveau câble" value={cableDraft.color} onChange={(event) => setCableDraft({ ...cableDraft, color: event.target.value })}><option value="pink">Rose</option><option value="blue">Bleu</option><option value="yellow">Jaune</option><option value="green">Vert</option><option value="white">Blanc</option></select>
                  </div>
                  <PatchMidiSettings cable={cableDraft} label="du nouveau câble" onChange={(update) => setCableDraft({ ...cableDraft, ...update })} />
                  <div className="cable-draft-actions">
                    <button className="outline-button" onClick={() => setCableDraft(null)}>Annuler</button>
                    <button className="primary-button" onClick={validateCable} disabled={!cableDraft.source || !cableDraft.destination}><Check size={15} /> Valider</button>
                  </div>
                </div>}
                {activeFacade.cables.length === 0 && !cableDraft ? (
                  <div className="empty-cables"><span className="empty-cable-icon"><Zap size={17} /></span><span>Aucune connexion saisie pour le moment.<small>Indique la sortie, l'entrée et la couleur du câble.</small></span></div>
                ) : (
                  <div className="cable-list">{activeFacade.cables.map((cable, index) => <div className="cable-row" key={cable.id}>
                    <span className={`cable-color ${cable.color}`} />
                    <select aria-label={`Sortie du câble ${index + 1}`} value={cableEndpoint(cable, "source", facades, workspace.module.name)} onChange={(event) => updateCable(cable.id, { source: event.target.value })}>
                      <option value="">Sortie…</option>
                      {withLegacyOption(patchOutputs, cableEndpoint(cable, "source", facades, workspace.module.name)).map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <span className="cable-arrow">→</span>
                    <select aria-label={`Entrée du câble ${index + 1}`} value={cableEndpoint(cable, "destination", facades, workspace.module.name)} onChange={(event) => updateCable(cable.id, { destination: event.target.value })}>
                      <option value="">Entrée…</option>
                      {withLegacyOption(patchInputs, cableEndpoint(cable, "destination", facades, workspace.module.name)).map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select value={cable.color} aria-label={`Couleur du câble ${index + 1}`} onChange={(event) => updateCable(cable.id, { color: event.target.value })}><option value="pink">Rose</option><option value="blue">Bleu</option><option value="yellow">Jaune</option><option value="green">Vert</option><option value="white">Blanc</option></select>
                    <button className="icon-button" onClick={() => removeCable(cable.id)} aria-label={`Supprimer le câble ${index + 1}`}><Trash2 size={16} /></button>
                    <PatchMidiSettings cable={cable} label={`du câble ${index + 1}`} onChange={(update) => updateCable(cable.id, update)} />
                  </div>)}</div>
                )}
              </div>

              <label className="notes-field"><span><Menu size={15} /> Notes sur ce module</span><textarea placeholder="Ex. attaque douce, accord de quinte, modulation lente…" value={activeFacade.notes} onChange={(event) => updateFacadeField("notes", event.target.value)} rows={2} /></label>
            </article>
          </section>

          </>}
          {(!mobile || mobileStep === 3) && <section className="recording-section">
            {mobile && <label className="mobile-recording-target">Associer le son à cette façade<select aria-label="Façade à enregistrer" value={activeFacade.id} disabled={navigationLocked} onChange={(event) => selectFacade(event.target.value)}>{facades.map((facade) => <option key={facade.id} value={facade.id}>{facade.name}</option>)}</select></label>}
            <div className="section-heading recording-heading">
              <div><span className="eyebrow">TRACE SONORE · {activeFacade.name.toUpperCase()}</span><h2>Les sons de cette façade</h2></div>
              <div className="tab-switch" role="tablist" aria-label="Méthode d'ajout de l'audio">
                <button disabled={navigationLocked} className={activeTab === "patch" ? "selected" : ""} onClick={() => setActiveTab("patch")} role="tab" aria-selected={activeTab === "patch"}><Mic size={14} /> Capturer</button>
                <button disabled={navigationLocked} className={activeTab === "sound" ? "selected" : ""} onClick={() => setActiveTab("sound")} role="tab" aria-selected={activeTab === "sound"}><Upload size={14} /> Importer</button>
              </div>
            </div>
            {activeTab === "patch" ? (
              <div className="capture-card">
                <span className={`capture-visual ${recording ? "is-recording" : ""}`}>{recording ? <span className="recording-pulse" /> : <AudioLines size={22} />}</span>
                <div className="capture-copy"><strong>{recording ? `Capture en cours pour « ${activeFacade.name} »` : `Prêt à enregistrer « ${activeFacade.name} »`}</strong><span>{recording ? "Le signal de l'entrée sélectionnée est capturé." : "Branche l'ES-9 en USB-C, choisis son entrée, puis lance la prise."}</span></div>
                {recording && <span className="recording-timer"><span />{formatDuration(recordingSeconds)}</span>}
                {!recording ? <button className="record-button" disabled={navigationLocked} onClick={() => void startRecording()}><span><Play size={15} fill="currentColor" /></span> Démarrer la prise</button> : <button className="stop-button" onClick={stopRecording}><Square size={14} fill="currentColor" /> Arrêter et enregistrer</button>}
              </div>
            ) : (
              <div className="import-card">
                <span className="import-icon"><Download size={19} /></span>
                <div><strong>Importer un enregistrement existant</strong><span>M4A, WAV, MP3 ou autre fichier audio de ton téléphone.</span></div>
                <button className="outline-button" disabled={navigationLocked} onClick={() => fileInputRef.current?.click()}><Upload size={15} /> Choisir un fichier</button>
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="audio/*,.m4a,.aac,.flac" onChange={(event) => void attachAudioFile(event.target.files?.[0])} />
              </div>
            )}
            <div className="audio-input-row">
              <span><Volume2 size={15} /> Source audio Android</span>
              <select disabled={navigationLocked} value={selectedInput} onChange={(event) => setSelectedInput(event.target.value)} aria-label="Entrée audio de capture">
                {audioInputs.length === 0 ? <option value="">Entrée par défaut (à détecter)</option> : audioInputs.map((input, index) => <option key={input.deviceId || index} value={input.deviceId}>{input.label || `Entrée audio ${index + 1}`}</option>)}
              </select>
              <button className="text-button scan-button" onClick={() => void refreshAudioInputs()}><Radio size={14} /> Détecter</button>
            </div>
            <div className="capture-footnote"><Sparkles size={14} /><span>Pas de réduction de bruit ni de gain automatique demandés, pour préserver le son synthétique. Android peut toutefois appliquer ses propres limites.</span></div>
            {audioSaving && <p role="status">Préparation ou sauvegarde de la prise audio…</p>}
            {activeFacade.recordings.length > 0 && <div className="recording-list">{activeFacade.recordings.map((attachment) => <AudioPlayer key={attachment.id} attachment={attachment} disabled={navigationLocked} onRemove={() => removeRecording(attachment.id)} />)}</div>}
            {activeFacade.recordings.length === 0 && <div className="empty-recordings"><Clock3 size={15} /> Aucun son attaché à cette façade.</div>}
          </section>}
          </>}

          {!mobile && <section className="patch-map-section" id="patch-map">
            <div className="subsection-heading"><div><span className="subsection-icon"><Zap size={15} /></span><span><strong>Plan de câblage</strong><small>Tous les PATCHES ou un PATCH · imprimable en A4</small></span></div><button className="outline-button" onClick={() => window.print()}><Download size={15} /> Imprimer A4</button></div>
            <PatchMap key={workspace.set.id} facades={facades} patches={workspace.patches} fallbackModule={workspace.module.name} setName={workspace.set.name} bpm={workspace.set.bpm} musicKey={workspace.set.key} masterClockFacadeId={workspace.set.masterClockFacadeId} />
          </section>}
          {mobile && <p className="mobile-web-note">Le câblage, les presets, le MIDI et les réglages avancés se gèrent sur l'interface web avec le même compte. Tes PATCHES, modules et sons y sont synchronisés automatiquement.</p>}

              <footer className="footer"><span>ANALOG MEMORY · ARCHIVE DE SET</span><span>{cloudEnabled && cloudState === "synced" ? "SET synchronisé avec ton compte Google." : "Les modifications seront synchronisées dans le cloud."}</span></footer>
        </main>}</>}
      </div>

      {toast && <div className="toast" role="status"><span><Check size={15} /></span>{toast}<button onClick={() => setToast("")} aria-label="Fermer"><X size={15} /></button></div>}
      {mobile && <div className="mobile-dock"><button disabled={navigationLocked} className={themeListVisible ? "dock-active" : ""} onClick={showThemes}><Disc3 size={18} /><span>SETS</span></button><button className={!themeListVisible && mobileStep === 2 ? "dock-active" : ""} disabled={!cloudEnabled || navigationLocked} onClick={() => changeMobileStep(2)}><Images size={18} /><span>Modules</span></button><button className={!themeListVisible && mobileStep === 3 ? "dock-active" : ""} disabled={!cloudEnabled || !patchFacades.length || navigationLocked} onClick={() => changeMobileStep(3)}><AudioLines size={18} /><span>Son</span></button></div>}
      <div className="sr-only"><Pause /><Camera /></div>
    </div>
  );
}
