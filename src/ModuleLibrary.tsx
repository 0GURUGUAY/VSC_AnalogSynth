import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, ChevronRight, Eye, Pencil, Plus, Save, ScanSearch, Search, SlidersHorizontal, Trash2, Waypoints, X } from "lucide-react";
import { analyzePanelPhoto, findHiddenJacks } from "./ai";
import { fetchCloudModuleMedia, listCloudPresets, putCloudModuleMedia, writeCloudPreset } from "./cloud";
import { findLibraryModules, prepareModuleForPhoto } from "./library";
import type { ModuleSort } from "./library";
import { KnobControl } from "./KnobControl";
import { PresetAudio } from "./PresetAudio";
import type { JackPort, LibraryModule, ModulePreset } from "./types";

function makeId(): string {
  return crypto.randomUUID();
}

function blankModule(): LibraryModule {
  const now = new Date().toISOString();
  return { id: makeId(), name: "", manufacturer: "", model: "", controls: [], jacks: [], createdAt: now, updatedAt: now };
}

export function ModuleLibrary({
  token,
  modules,
  onSave,
  onAddToTheme,
  onBackToTheme,
  showToast,
  themeAvailable = true,
  onAudioBusyChange,
}: {
  token: string;
  modules: LibraryModule[];
  onSave: (module: LibraryModule) => Promise<void>;
  onAddToTheme: (module: LibraryModule, preset?: ModulePreset) => void;
  onBackToTheme: () => void;
  showToast: (message: string) => void;
  themeAvailable?: boolean;
  onAudioBusyChange?: (busy: boolean) => void;
}) {
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? "");
  const [draft, setDraft] = useState<LibraryModule | null>(null);
  const [presets, setPresets] = useState<ModulePreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetValues, setPresetValues] = useState<Record<string, number | null>>({});
  const [editingPreset, setEditingPreset] = useState<ModulePreset | null>(null);
  const [viewedPresetId, setViewedPresetId] = useState("");
  const [presetNotes, setPresetNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ModuleSort>("name");
  const [editorOpen, setEditorOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const filteredModules = useMemo(() => findLibraryModules(modules, search, sort), [modules, search, sort]);
  const navigationLocked = saving || audioBusy || analyzing;

  function openModule(id: string) {
    setModuleId(id);
    setEditorOpen(true);
    if (window.matchMedia("(max-width: 680px)").matches) {
      window.requestAnimationFrame(() => {
        editorRef.current?.scrollIntoView({ block: "start" });
        editorRef.current?.focus({ preventScroll: true });
      });
    }
  }

  function backToLibrary() {
    setEditorOpen(false);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }
  useEffect(() => { onAudioBusyChange?.(audioBusy); }, [audioBusy, onAudioBusyChange]);
  useEffect(() => () => { onAudioBusyChange?.(false); }, [onAudioBusyChange]);

  useEffect(() => {
    setPresetValues({});
    setPresetName("");
    setEditingPreset(null);
    setViewedPresetId("");
    setPresetNotes("");
  }, [moduleId]);

  useEffect(() => {
    const module = modules.find((item) => item.id === moduleId);
    if (!module) {
      if (draft?.id === moduleId) return;
      setModuleId(modules[0]?.id ?? "");
      setDraft(null);
      setPresets([]);
      return;
    }
    setDraft(structuredClone(module));
  }, [modules, moduleId, draft?.id]);

  const moduleExists = modules.some((item) => item.id === moduleId);
  useEffect(() => {
    setPresets([]);
    if (!token || !moduleExists) return;
    let cancelled = false;
    listCloudPresets(token, moduleId).then((result) => {
      if (!cancelled) setPresets(result);
    }).catch((error: unknown) => {
      if (!cancelled) showToast(error instanceof Error ? error.message : "Impossible de charger les presets.");
    });
    return () => { cancelled = true; };
  }, [moduleExists, moduleId, token, showToast]);

  useEffect(() => {
    let active = true;
    let url = "";
    setPhotoUrl("");
    if (!draft?.photoId || !token) return;
    fetchCloudModuleMedia(token, draft.id, draft.photoId).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPhotoUrl(url);
    }).catch((error: unknown) => {
      if (active) showToast(error instanceof Error ? error.message : "Impossible de charger la photo du module.");
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [draft?.id, draft?.photoId, token, showToast]);

  const activePresetValues = useMemo(() => Object.fromEntries(
    (draft?.controls ?? []).map((control) => [control.id, presetValues[control.id] ?? null]),
  ), [draft?.controls, presetValues]);

  function updateDraft(update: (module: LibraryModule) => LibraryModule) {
    setDraft((current) => current ? { ...update(current), updatedAt: new Date().toISOString() } : current);
  }

  function addModule() {
    const module = blankModule();
    openModule(module.id);
    setDraft(module);
    setPresets([]);
  }

  async function saveModule() {
    if (!draft) return;
    if (!draft.name.trim()) {
      showToast("Donne un nom au module avant de l'enregistrer.");
      return;
    }
    if (draft.controls.some((control) => !control.label.trim()) || draft.jacks.some((jack) => !jack.label.trim())) {
      showToast("Chaque contrôle et chaque port doit avoir un nom avant l'enregistrement.");
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      showToast(`Module « ${draft.name} » enregistré dans la bibliothèque.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossible d'enregistrer le module.");
    } finally {
      setSaving(false);
    }
  }

  function resetPresetEditor() {
    setEditingPreset(null);
    setPresetName("");
    setPresetValues({});
    setPresetNotes("");
  }

  function editPreset(preset: ModulePreset) {
    setEditingPreset(preset);
    setPresetName(preset.name);
    setPresetValues({ ...preset.values });
    setPresetNotes(preset.notes);
  }

  async function savePreset() {
    if (!draft || !presetName.trim()) {
      showToast("Donne un nom à ce preset.");
      return;
    }
    const now = new Date().toISOString();
    const existingAudio = editingPreset ? presets.find((item) => item.id === editingPreset.id)?.audio : undefined;
    const preset: ModulePreset = {
      id: editingPreset?.id ?? makeId(),
      name: presetName.trim(),
      values: activePresetValues,
      notes: presetNotes,
      createdAt: editingPreset?.createdAt ?? now,
      updatedAt: now,
      ...(existingAudio ? { audio: existingAudio } : {}),
    };
    setSaving(true);
    try {
      if (!editingPreset) await onSave(draft);
      const saved = await writeCloudPreset(token, draft.id, preset);
      setPresets((current) => editingPreset
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current.filter((item) => item.id !== saved.id)]);
      resetPresetEditor();
      showToast(`Preset « ${saved.name} » ${editingPreset ? "modifié" : "enregistré"}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossible d'enregistrer le preset.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file?: File) {
    if (!draft || !file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("Choisis une photo JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast("La photo doit faire 8 Mio maximum.");
      return;
    }
    setSaving(true);
    try {
      const module = prepareModuleForPhoto(draft);
      await onSave(module);
      const photoId = makeId();
      await putCloudModuleMedia(token, module.id, photoId, file);
      const updated = { ...module, photoId, updatedAt: new Date().toISOString() };
      await onSave(updated);
      setDraft(updated);
      showToast("Photo de référence enregistrée.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossible d'enregistrer cette photo.");
    } finally {
      setSaving(false);
      setPhotoInputKey((key) => key + 1);
    }
  }

  async function analyzePhoto() {
    if (!draft || !photoUrl) return;
    setAnalyzing(true);
    try {
      const blob = await fetchCloudModuleMedia(token, draft.id, draft.photoId!);
      const analysis = await analyzePanelPhoto(blob, token);
      let jacks: JackPort[] = analysis.jacks.map(({ id, label, direction, location }) => ({ id, label, direction, location }));
      try {
        const hidden = await findHiddenJacks({
          moduleName: analysis.moduleName,
          manufacturer: analysis.manufacturer,
          visibleJacks: jacks.map((jack) => jack.label),
        }, token);
        jacks = [...jacks, ...hidden.map((jack, index) => ({
          id: `hidden-${index + 1}-${makeId().slice(0, 8)}`,
          label: jack.label,
          direction: jack.direction,
          location: jack.location,
        }))];
      } catch (error) {
        showToast(`Connecteurs cachés non vérifiés : ${error instanceof Error ? error.message : "recherche impossible."}`);
      }
      const updated: LibraryModule = {
        ...draft,
        name: analysis.moduleName || draft.name,
        manufacturer: analysis.manufacturer || draft.manufacturer,
        model: analysis.model || draft.model,
        controls: analysis.controls.map(({ id, label, kind }) => ({ id, label, kind })),
        jacks,
        updatedAt: new Date().toISOString(),
      };
      await onSave(updated);
      setDraft(updated);
      setPresetValues(Object.fromEntries(analysis.controls.map((control) => [control.id, control.value])));
      showToast("Contrôles et connecteurs repérés. Vérifie les suggestions avant de les utiliser.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Analyse de la photo impossible.");
    } finally {
      setAnalyzing(false);
    }
  }

  function addControl() {
    if (!draft) return;
    const id = `control-${crypto.randomUUID().slice(0, 8)}`;
    updateDraft((module) => ({ ...module, controls: [...module.controls, { id, label: "", kind: "knob" }] }));
  }

  function updateControl(id: string, update: (control: LibraryModule["controls"][number]) => LibraryModule["controls"][number]) {
    updateDraft((module) => ({ ...module, controls: module.controls.map((control) => control.id === id ? update(control) : control) }));
  }

  function addJack() {
    if (!draft) return;
    const jack: JackPort = { id: `jack-${crypto.randomUUID().slice(0, 8)}`, label: "", direction: "bidirectional" };
    updateDraft((module) => ({ ...module, jacks: [...module.jacks, jack] }));
  }

  function updateJack(id: string, update: (jack: JackPort) => JackPort) {
    updateDraft((module) => ({ ...module, jacks: module.jacks.map((jack) => jack.id === id ? update(jack) : jack) }));
  }

  return (
    <section className={`main-content module-library-page ${editorOpen ? "module-library-editing" : ""}`}>
      <div className="breadcrumbs"><span>ESPACE DE TRAVAIL</span><span className="crumb-slash">/</span><strong>Bibliothèque de modules</strong></div>
      <div className="module-library-workspace">
      <section className="module-library-browser" aria-label="Parcourir les modules">
        <div className="module-library-tools">
          <label className="module-library-search"><Search size={17} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Rechercher un module" placeholder="Nom, fabricant, modèle…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="module-library-sort">
            <span role="status">{filteredModules.length} / {modules.length} module{modules.length === 1 ? "" : "s"}</span>
            <label className="visually-hidden" htmlFor="module-library-sort">Trier les modules</label>
            <select id="module-library-sort" value={sort} onChange={(event) => setSort(event.target.value === "recent" ? "recent" : "name")}><option value="name">Nom · A–Z</option><option value="recent">Modifiés récemment</option></select>
            <button className="primary-button library-create-button" onClick={addModule} disabled={navigationLocked}><Plus size={15} /> Nouveau module</button>
          </div>
        </div>
        <div className="module-library-list" aria-label="Modules enregistrés">
          {filteredModules.map((module) => <button key={module.id} className={`module-library-item ${module.id === moduleId ? "selected" : ""}`} onClick={() => openModule(module.id)} disabled={navigationLocked} aria-pressed={module.id === moduleId}>
            <span className="module-library-card-icon"><SlidersHorizontal size={18} /></span>
            <span className="module-library-card-copy"><strong>{module.name}</strong><small>{module.manufacturer || "Fabricant non renseigné"}</small>{module.model && module.model !== module.name && <small>{module.model}</small>}<small className="module-library-card-count">{module.controls.length} contrôle{module.controls.length === 1 ? "" : "s"} · {module.jacks.length} port{module.jacks.length === 1 ? "" : "s"}</small></span>
            {module.id === moduleId ? <Check size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          </button>)}
        </div>
        {modules.length > 0 && filteredModules.length === 0 && <div className="module-library-no-results"><Search size={22} /><strong>Aucun module trouvé</strong><p>Essaie un autre nom, fabricant ou modèle.</p><button className="outline-button" onClick={() => setSearch("")}>Effacer la recherche</button></div>}
        {modules.length === 0 && <p className="module-editor-hint">Les modules enregistrés apparaîtront ici.</p>}
      </section>
      <div ref={editorRef} className="module-library-detail" tabIndex={-1} aria-label="Éditeur du module">
        <button className="outline-button module-library-return" onClick={backToLibrary} disabled={navigationLocked}><ArrowLeft size={16} /> Tous les modules</button>
      {!draft ? <div className="module-library-empty">
        <SlidersHorizontal size={26} />
        <strong>Ta bibliothèque commence ici.</strong>
        <span>Ajoute un module pour définir ses boutons, faders, entrées et sorties.</span>
        <button className="primary-button" onClick={addModule} disabled={navigationLocked}><Plus size={15} /> Créer un module</button>
      </div> : <>
        <section className="module-editor-card">
          <div className="section-heading"><div><span className="eyebrow">IDENTITÉ DU MODULE</span><h2>{draft.name || "Nouveau module"}</h2></div><button className="outline-button" onClick={onBackToTheme} disabled={audioBusy}><ArrowLeft size={14} /> {themeAvailable ? "Retour au SET" : "Mes SETS"}</button></div>
          <div className="module-editor-grid">
            <label>Nom du module<input maxLength={500} value={draft.name} onChange={(event) => updateDraft((module) => ({ ...module, name: event.target.value }))} placeholder="Ex. Rings" /></label>
            <label>Fabricant<input maxLength={500} value={draft.manufacturer} onChange={(event) => updateDraft((module) => ({ ...module, manufacturer: event.target.value }))} /></label>
            <label>Modèle / référence<input maxLength={500} value={draft.model} onChange={(event) => updateDraft((module) => ({ ...module, model: event.target.value }))} /></label>
          </div>
          <div className="module-photo-editor">
            <div className="module-photo-preview">{photoUrl ? <img src={photoUrl} alt={`Façade de ${draft.name}`} /> : <span><Camera size={20} />Photo de référence du module</span>}</div>
            <div><strong>Façade de référence</strong><small>Cette photo appartient au module et est réutilisée dans tes PATCHES.</small>
              <div className="module-editor-actions">
                <button className="outline-button" onClick={() => document.getElementById("module-photo-input")?.click()} disabled={saving}><Camera size={14} /> {photoUrl ? "Changer la photo" : "Ajouter une photo"}</button>
                <button className="outline-button" onClick={() => void analyzePhoto()} disabled={!photoUrl || analyzing || saving}><ScanSearch size={14} /> {analyzing ? "Analyse…" : "Repérer les contrôles et ports"}</button>
                <input key={photoInputKey} id="module-photo-input" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadPhoto(event.target.files?.[0])} />
              </div>
            </div>
          </div>
          <div className="module-editor-block">
            <div className="subsection-heading"><div><span className="subsection-icon"><SlidersHorizontal size={14} /></span><span><strong>Contrôles de la façade</strong><small>Boutons rotatifs et faders</small></span></div><button className="outline-button" onClick={addControl}><Plus size={14} /> Ajouter un contrôle</button></div>
            {draft.controls.map((control) => <div className="module-definition-row" key={control.id}>
              <input aria-label="Nom du contrôle" maxLength={500} placeholder="Nom du contrôle" value={control.label} onChange={(event) => updateControl(control.id, (item) => ({ ...item, label: event.target.value }))} />
              <select aria-label={`Type de contrôle ${control.label || ""}`} value={control.kind ?? "knob"} onChange={(event) => updateControl(control.id, (item) => ({ ...item, kind: event.target.value === "slider" ? "slider" : "knob" }))}><option value="knob">Bouton rotatif</option><option value="slider">Fader</option></select>
              <input aria-label="Indication du contrôle" maxLength={500} placeholder="Indication (facultatif)" value={control.hint ?? ""} onChange={(event) => updateControl(control.id, (item) => ({ ...item, hint: event.target.value }))} />
              <button className="icon-button danger-text" aria-label={`Supprimer ${control.label || "ce contrôle"}`} onClick={() => updateDraft((module) => ({ ...module, controls: module.controls.filter((item) => item.id !== control.id) }))}><Trash2 size={15} /></button>
            </div>)}
            {draft.controls.length === 0 && <p className="module-editor-hint">Aucun contrôle ajouté pour l'instant.</p>}
          </div>
          <div className="module-editor-block">
            <div className="subsection-heading"><div><span className="subsection-icon"><Waypoints size={14} /></span><span><strong>Entrées et sorties</strong><small>Ports audio, CV, MIDI ou USB</small></span></div><button className="outline-button" onClick={addJack}><Plus size={14} /> Ajouter un port</button></div>
            {draft.jacks.map((jack) => <div className="module-definition-row" key={jack.id}>
              <input aria-label="Nom du port" maxLength={500} placeholder="Nom du port" value={jack.label} onChange={(event) => updateJack(jack.id, (item) => ({ ...item, label: event.target.value }))} />
              <select aria-label={`Direction ${jack.label || ""}`} value={jack.direction} onChange={(event) => updateJack(jack.id, (item) => ({ ...item, direction: event.target.value as JackPort["direction"] }))}><option value="input">Entrée</option><option value="output">Sortie</option><option value="bidirectional">Entrée / sortie</option></select>
              <input aria-label="Emplacement du port" maxLength={500} placeholder="Face avant / arrière" value={jack.location ?? ""} onChange={(event) => updateJack(jack.id, (item) => ({ ...item, location: event.target.value }))} />
              <button className="icon-button danger-text" aria-label={`Supprimer ${jack.label || "ce port"}`} onClick={() => updateDraft((module) => ({ ...module, jacks: module.jacks.filter((item) => item.id !== jack.id) }))}><Trash2 size={15} /></button>
            </div>)}
            {draft.jacks.length === 0 && <p className="module-editor-hint">Aucun port ajouté pour l'instant.</p>}
          </div>
          <div className="module-editor-actions">
            <button className="primary-button" onClick={() => void saveModule()} disabled={saving || audioBusy}><Save size={15} /> Enregistrer le module</button>
            {themeAvailable && <button className="outline-button" onClick={() => onAddToTheme(draft)} disabled={audioBusy}><Plus size={15} /> Ajouter au PATCH sélectionné</button>}
          </div>
        </section>
        <section className="module-editor-card preset-editor">
          <div className="section-heading"><div><span className="eyebrow">RÉGLAGES MÉMORISÉS</span><h2>Presets</h2></div></div>
          <p className="module-editor-hint" role="status">{editingPreset ? `Édition du preset « ${editingPreset.name} »` : "Nouveau preset"}</p>
          {draft.controls.length > 0 && <div className="preset-values">
            {draft.controls.map((control) => <KnobControl key={control.id} control={{ ...control, label: control.label || "Contrôle" }} value={presetValues[control.id] ?? null} disabled={saving} onChange={(value) => setPresetValues((current) => ({ ...current, [control.id]: value }))} />)}
          </div>}
          <label className="preset-notes">Notes du preset<textarea maxLength={10000} rows={3} value={presetNotes} disabled={saving} onChange={(event) => setPresetNotes(event.target.value)} /></label>
          <div className="module-editor-actions">
            <input className="preset-name-input" aria-label={editingPreset ? "Nom du preset" : "Nom du nouveau preset"} maxLength={500} placeholder="Nom du preset" value={presetName} disabled={saving} onChange={(event) => setPresetName(event.target.value)} />
            <button className="primary-button" onClick={() => void savePreset()} disabled={saving || audioBusy}>{editingPreset ? <Save size={14} /> : <Plus size={14} />} {saving ? "Enregistrement…" : editingPreset ? "Enregistrer les modifications" : "Enregistrer le preset"}</button>
            {editingPreset && <button className="outline-button" onClick={resetPresetEditor} disabled={saving}><X size={14} /> Annuler l’édition</button>}
          </div>
          {presets.map((preset) => <div className={`preset-library-item ${viewedPresetId === preset.id ? "viewed" : ""}`} key={preset.id}>
            <div className="preset-library-row">
            <span><strong>{preset.name}</strong><small>{Object.values(preset.values).filter((value) => value !== null).length} réglage(s) renseigné(s){preset.audio ? " · Son de référence associé" : ""}</small></span>
            <div className="preset-library-actions">
              <button className="outline-button" onClick={() => setViewedPresetId((current) => current === preset.id ? "" : preset.id)} disabled={saving || audioBusy} aria-label={`${viewedPresetId === preset.id ? "Masquer" : "Voir"} le preset ${preset.name}`} aria-expanded={viewedPresetId === preset.id} aria-controls={`preset-preview-${preset.id}`}><Eye size={14} /> {viewedPresetId === preset.id ? "Masquer" : "Voir"}</button>
              <button className="outline-button" onClick={() => editPreset(preset)} disabled={saving || audioBusy} aria-label={`Modifier le preset ${preset.name}`} aria-pressed={editingPreset?.id === preset.id}><Pencil size={14} /> Modifier</button>
              {themeAvailable && <button className="outline-button" onClick={() => onAddToTheme(draft, preset)} disabled={saving || audioBusy}><Plus size={14} /> Utiliser dans ce PATCH</button>}
            </div>
            </div>
            <section id={`preset-preview-${preset.id}`} className="preset-preview" aria-label={`Réglages du preset ${preset.name}`} hidden={viewedPresetId !== preset.id}>
              {viewedPresetId === preset.id && <>
                <p className="module-editor-hint">Réglages enregistrés · Lecture seule</p>
                {draft.controls.length > 0 ? <div className="preset-values">
                  {draft.controls.map((control) => <KnobControl key={control.id} control={{ ...control, label: control.label || "Contrôle" }} value={preset.values[control.id] ?? null} disabled onChange={() => {}} />)}
                </div> : <p className="module-editor-hint">Aucun contrôle défini pour ce module.</p>}
                {preset.notes && <p className="preset-preview-notes">{preset.notes}</p>}
                <PresetAudio key={`${draft.id}-${preset.id}`} token={token} moduleId={draft.id} preset={preset} disabled={saving} showToast={showToast} onBusyChange={setAudioBusy} onSaved={(saved) => setPresets((current) => current.map((item) => item.id === saved.id ? saved : item))} />
              </>}
            </section>
          </div>)}
          {presets.length === 0 && <p className="module-editor-hint">Aucun preset enregistré pour ce module.</p>}
        </section>
      </>}
      </div>
      </div>
      <button className="text-button module-library-back" onClick={onBackToTheme} disabled={audioBusy}><ArrowLeft size={14} /> Retour à mon SET</button>
    </section>
  );
}
