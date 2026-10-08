import { useEffect, useRef, useState } from "react";
import { Mic, Save, Square, Trash2, Upload, X } from "lucide-react";
import { audioAttachment, MAX_AUDIO_BYTES, validateAudio } from "./audio";
import { fetchCloudModuleMedia, putCloudModuleMedia, writeCloudPresetAudio } from "./cloud";
import type { AudioAttachment, ModulePreset } from "./types";

type PendingAudio = { blob: Blob; attachment: AudioAttachment };

export function PresetAudio({
  token, moduleId, preset, onSaved, showToast, onBusyChange, disabled = false,
}: {
  token: string;
  moduleId: string;
  preset: ModulePreset;
  onSaved: (preset: ModulePreset) => void;
  showToast: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<PendingAudio | null>(null);
  const [pendingUrl, setPendingUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const dirtyRef = useRef(false);
  const uploadedRef = useRef(new Set<string>());
  const busy = requesting || recording || saving || pending !== null;
  dirtyRef.current = busy;

  function reportError(reason: unknown) {
    const message = reason instanceof Error ? reason.message : "Impossible d'enregistrer le son du preset.";
    if (mountedRef.current) setError(message);
    showToast(message);
  }

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recorderRef.current) {
        recorderRef.current.onstop = null;
        recorderRef.current.onerror = null;
        recorderRef.current.ondataavailable = null;
        if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      onBusyChange(false);
      if (dirtyRef.current) showToast("La prise audio non sauvegardée a été interrompue. Reste sur le preset jusqu'à l'enregistrement du son.");
    };
  }, [onBusyChange, showToast]);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl("");
    setLoading(false);
    if (!preset.audio) return;
    setLoading(true);
    fetchCloudModuleMedia(token, moduleId, preset.audio.id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Impossible de charger le son du preset.");
    }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, moduleId, preset.audio?.id]);

  useEffect(() => {
    if (!pending) {
      setPendingUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(pending.blob);
    setPendingUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pending]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    const stopWhenHidden = () => {
      if (document.hidden && recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        showToast("La capture s'est arrêtée au passage en arrière-plan. Écoute puis sauvegarde la prise en revenant sur le preset.");
      }
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [recording, showToast]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function detectInputs() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error("La liste des entrées audio n'est pas disponible.");
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (mountedRef.current) setInputs(devices.filter((device) => device.kind === "audioinput"));
    } catch (reason) { reportError(reason); }
  }

  async function startRecording() {
    setError("");
    setRequesting(true);
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Capture audio indisponible. Utilise l'application Android ou un navigateur HTTPS avec accès au microphone.");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          ...(inputId ? { deviceId: { exact: inputId } } : {}),
        },
        video: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      let bytes = 0;
      let failed = false;
      const releaseStream = () => {
        stream?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      recorder.ondataavailable = (event) => {
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          failed = true;
          reportError(new Error("La prise dépasse 25 Mio. Enregistre une prise plus courte."));
          if (recorder.state !== "inactive") recorder.stop();
        } else if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        failed = true;
        reportError(new Error("La capture audio a échoué. Vérifie l'entrée et l'autorisation microphone Android."));
        if (recorder.state !== "inactive") recorder.stop();
        releaseStream();
        setRecording(false);
      };
      recorder.onstop = () => {
        releaseStream();
        if (!mountedRef.current) return;
        setRecording(false);
        if (failed) return;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const type = validateAudio(blob);
          const normalized = blob.slice(0, blob.size, type);
          const extension = type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm";
          setPending({
            blob: normalized,
            attachment: audioAttachment(normalized, `${preset.name}.${extension}`, Math.max(0, (Date.now() - startedAt) / 1000)),
          });
        } catch (reason) { reportError(reason); }
      };
      recorder.start(500);
      setSeconds(0);
      setRecording(true);
      void detectInputs();
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      reportError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? new Error("Accès au microphone refusé. Autorise le microphone dans les paramètres de l'application Android ou du navigateur.")
        : reason);
    } finally { if (mountedRef.current) setRequesting(false); }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function importAudio(file?: File) {
    if (!file) return;
    try {
      const extensionTypes: Record<string, string> = {
        m4a: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav",
        flac: "audio/flac", ogg: "audio/ogg", webm: "audio/webm",
      };
      const type = file.type || extensionTypes[file.name.split(".").pop()?.toLowerCase() ?? ""];
      const blob = file.slice(0, file.size, type);
      const normalized = blob.slice(0, blob.size, validateAudio(blob));
      setPending({ blob: normalized, attachment: audioAttachment(normalized, file.name, 0) });
      setError("");
    } catch (reason) { reportError(reason); }
  }

  async function saveAudio() {
    if (!pending) return;
    setSaving(true);
    setError("");
    try {
      if (!uploadedRef.current.has(pending.attachment.id)) {
        await putCloudModuleMedia(token, moduleId, pending.attachment.id, pending.blob);
        uploadedRef.current.add(pending.attachment.id);
      }
      const saved = await writeCloudPresetAudio(token, moduleId, preset.id, pending.attachment);
      if (!mountedRef.current) return;
      dirtyRef.current = false;
      onSaved(saved);
      setPending(null);
      showToast(`Son associé au preset « ${saved.name} ».`);
    } catch (reason) { reportError(reason); }
    finally { if (mountedRef.current) setSaving(false); }
  }

  async function removeAudio() {
    if (!window.confirm("Retirer le son de référence de ce preset ?")) return;
    setSaving(true);
    setError("");
    try {
      const saved = await writeCloudPresetAudio(token, moduleId, preset.id, null);
      if (!mountedRef.current) return;
      onSaved(saved);
      showToast("Son retiré du preset.");
    } catch (reason) { reportError(reason); }
    finally { if (mountedRef.current) setSaving(false); }
  }

  return <section className="preset-audio" aria-label={`Son du preset ${preset.name}`}>
    <strong><Mic size={16} /> Son de référence du preset</strong>
    {preset.audio ? <>
      <span className="module-editor-hint">{preset.audio.name}</span>
      {loading && <p role="status">Chargement du son…</p>}
      {url && <audio controls preload="metadata" src={url} aria-label={`Écouter le son du preset ${preset.name}`} />}
    </> : <p className="module-editor-hint">Aucun son associé à ce preset.</p>}
    <p className="module-editor-hint">Sur Android, autorise le microphone et branche ton interface USB-C avant la prise. Reste sur ce preset jusqu'à la sauvegarde. Le nouveau son remplacera le précédent.</p>
    <div className="preset-audio-source">
      <label>Entrée audio<select aria-label="Entrée audio du preset" value={inputId} disabled={disabled || busy} onChange={(event) => setInputId(event.target.value)}>
        <option value="">Entrée par défaut du téléphone / navigateur</option>
        {inputs.filter((input) => input.deviceId).map((input, index) => <option key={input.deviceId} value={input.deviceId}>{input.label || `Entrée audio ${index + 1}`}</option>)}
      </select></label>
      <button className="outline-button" onClick={() => void detectInputs()} disabled={disabled || busy}>Détecter les entrées</button>
    </div>
    <div className="preset-library-actions">
      {recording ? <button className="stop-button" onClick={stopRecording}><Square size={16} /> Arrêter · {seconds} s</button>
        : <button className="record-button" onClick={() => void startRecording()} disabled={disabled || busy}><Mic size={16} /> {requesting ? "Autorisation microphone…" : "Enregistrer un son"}</button>}
      <button className="outline-button" onClick={() => fileRef.current?.click()} disabled={disabled || busy}><Upload size={16} /> Importer un son</button>
      <input ref={fileRef} type="file" className="visually-hidden" accept="audio/*,.m4a,.aac,.wav,.mp3,.flac,.ogg,.webm" onChange={(event) => { importAudio(event.target.files?.[0]); event.target.value = ""; }} />
      {preset.audio && <button className="outline-button" onClick={() => void removeAudio()} disabled={disabled || busy}><Trash2 size={16} /> Retirer le son</button>}
    </div>
    {pending && <div className="preset-audio-pending">
      <p className="module-editor-hint">Prise à sauvegarder : {pending.attachment.name} · {(pending.blob.size / 1024 / 1024).toFixed(1)} Mio</p>
      {pendingUrl && <audio controls src={pendingUrl} aria-label="Écouter la prise avant sauvegarde" />}
      <div className="preset-library-actions">
        <button className="primary-button" onClick={() => void saveAudio()} disabled={saving || disabled}><Save size={16} /> {saving ? "Sauvegarde du son…" : "Sauvegarder le son du preset"}</button>
        <button className="outline-button" onClick={() => { setPending(null); setError(""); }} disabled={saving}><X size={16} /> Annuler la prise</button>
      </div>
    </div>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
