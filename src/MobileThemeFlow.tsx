import { useMemo, useState } from "react";
import { AudioLines, Plus, Search, Trash2 } from "lucide-react";
import { findLibraryModules } from "./library";
import type { Facade, LibraryModule } from "./types";

export type MobileThemeStep = 1 | 2 | 3;

export function MobileThemeSteps({ step, themeAvailable, hasFacades, disabled, onStep }: {
  step: MobileThemeStep;
  themeAvailable: boolean;
  hasFacades: boolean;
  disabled: boolean;
  onStep: (step: MobileThemeStep) => void;
}) {
  return <nav className="mobile-theme-steps" aria-label="Création du SET">
    {(["Choisir un SET", "Ajouter des modules", "Enregistrer mon son"] as const).map((label, index) => {
      const target = (index + 1) as MobileThemeStep;
      return <button key={label} aria-current={step === target ? "step" : undefined}
        disabled={disabled || (target > 1 && !themeAvailable) || (target === 3 && !hasFacades)}
        onClick={() => onStep(target)}><span>{target}</span>{label}</button>;
    })}
  </nav>;
}

export function MobileThemeFacades({ modules, facades, activeId, disabled, onAdd, onSelect, onRemove, onContinue }: {
  modules: LibraryModule[];
  facades: Facade[];
  activeId: string;
  disabled: boolean;
  onAdd: (module: LibraryModule) => Promise<void>;
  onSelect: (id: string) => void;
  onRemove: () => void;
  onContinue: () => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const filtered = useMemo(() => findLibraryModules(modules, search, "name"), [modules, search]);
  const locked = disabled || adding;
  return <section className="mobile-theme-facades">
    <h2>Ajoute tes modules</h2>
    <p>Choisis les appareils du PATCH sélectionné. Tu pourras compléter le câblage sur le web.</p>
    {facades.length > 0 && <div className="mobile-selected-facades" aria-label="Modules du PATCH">
      {facades.map((facade) => <button key={facade.id} disabled={locked} aria-pressed={facade.id === activeId} onClick={() => onSelect(facade.id)}>{facade.name}</button>)}
      <button className="text-button danger-text" disabled={locked} onClick={onRemove}><Trash2 size={15} /> Retirer la façade sélectionnée</button>
    </div>}
    <label className="module-library-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Rechercher une façade" placeholder="Nom, fabricant, modèle…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="mobile-facade-picker">
      {filtered.map((module) => <button className="outline-button" key={module.id} disabled={locked} onClick={async () => {
        setAdding(true);
        try { await onAdd(module); } finally { setAdding(false); }
      }}><span><strong>{module.name}</strong><small>{module.manufacturer}</small></span><Plus size={20} aria-hidden="true" /><span className="visually-hidden">Ajouter au PATCH</span></button>)}
    </div>
    {!modules.length ? <p role="status">Prépare tes façades dans la bibliothèque Modules sur le web, puis retrouve-les ici avec le même compte.</p>
      : !filtered.length && <p role="status">Aucune façade trouvée.</p>}
    <button className="primary-button mobile-flow-continue" disabled={locked || !facades.length} onClick={onContinue}><AudioLines size={18} /> Passer à l'enregistrement</button>
  </section>;
}
