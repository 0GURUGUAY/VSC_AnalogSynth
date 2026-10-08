import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Save, Trash2, X } from "lucide-react";
import { readGeminiSettings, writeGeminiSettings } from "./cloud";
import type { GeminiSettings } from "./cloud";

export function GeminiConfiguration({ token, onClose }: { token: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<GeminiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let active = true;
    setError("");
    readGeminiSettings(token).then((value) => {
      if (active) setSettings(value);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Impossible de charger la configuration.");
    });
    return () => { active = false; };
  }, [token, attempt]);

  async function save(value: string | null) {
    if (value !== null && !/^[A-Za-z0-9_-]{20,200}$/.test(value.trim())) {
      setError("La clé doit contenir entre 20 et 200 caractères, sans espace.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setSettings(await writeGeminiSettings(token, value === null ? null : value.trim()));
      setApiKey("");
      setVisible(false);
      setMessage(value === null ? "Clé personnelle supprimée." : "Clé enregistrée. Elle sera utilisée pour les prochaines analyses.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Impossible d'enregistrer la clé.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="gemini-configuration" aria-labelledby="gemini-title" onCancel={(event) => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <div className="configuration-heading">
        <h2 id="gemini-title">Configuration</h2>
        <button className="icon-button" aria-label="Fermer la configuration" onClick={onClose} disabled={busy}><X size={20} /></button>
      </div>
      <h3>Gemini</h3>
      <p>Utilise ta propre clé API pour analyser les photos des modules et rechercher leurs connecteurs.</p>
      <p>La clé est conservée dans ton compte cloud privé, côté serveur, pour Web et mobile. Elle n'est pas renvoyée à l'application ni incluse dans les thèmes exportés.</p>
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Créer une clé dans Google AI Studio</a>
      {!settings && !error && <p role="status">Chargement de la configuration…</p>}
      {settings && <p className="configuration-status">{settings.configured ? "Une clé personnelle est enregistrée." : settings.serverAvailable ? "Aucune clé personnelle. La clé du serveur est utilisée." : "Aucune clé Gemini configurée."}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void save(apiKey); }}>
        <label htmlFor="gemini-api-key">{settings?.configured ? "Remplacer la clé API" : "Clé API Gemini"}</label>
        <div className="configuration-key">
          <input id="gemini-api-key" type={visible ? "text" : "password"} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setMessage(""); }} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={200} placeholder="Colle ta clé API ici" disabled={!settings || busy} />
          <button type="button" className="icon-button" aria-label={visible ? "Masquer la clé" : "Afficher la clé"} aria-pressed={visible} onClick={() => setVisible(!visible)} disabled={busy}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
        <p>Les quotas et éventuels frais Gemini sont liés à ton projet Google. L'enregistrement ne vérifie pas la validité de la clé auprès de Gemini.</p>
        {error && <p className="cloud-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div className="configuration-actions">
          <button className="primary-button" type="submit" disabled={!settings || busy || !apiKey.trim()}><Save size={16} />{busy ? "Enregistrement…" : "Enregistrer"}</button>
          {settings?.configured && <button className="outline-button" type="button" disabled={busy} onClick={() => {
            if (window.confirm("Supprimer ta clé Gemini personnelle ? La clé du serveur sera utilisée si elle est disponible.")) void save(null);
          }}><Trash2 size={16} />Supprimer la clé</button>}
          {!settings && error && <button className="outline-button" type="button" onClick={() => setAttempt(attempt + 1)}>Réessayer</button>}
        </div>
      </form>
    </dialog>
  );
}
