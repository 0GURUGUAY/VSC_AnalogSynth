import { useMemo, useState } from "react";
import { ChevronRight, Disc3, Plus, RefreshCw, Search } from "lucide-react";
import type { CloudTheme } from "./cloud";

export function findThemes(themes: CloudTheme[], query: string, sort: "name" | "recent"): CloudTheme[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return themes.filter(({ set }) => {
    const text = normalize([set.name, set.artist, set.musicians, set.project, set.genre, set.tags, set.key, set.bpm].join(" "));
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => sort === "recent"
    ? b.updatedAt.localeCompare(a.updatedAt) || a.set.name.localeCompare(b.set.name, "fr", { numeric: true })
    : a.set.name.localeCompare(b.set.name, "fr", { numeric: true }));
}

export function ThemeLibrary({
  themes, activeId, disabled, refreshing = false, onOpen, onCreate, onRefresh,
}: {
  themes: CloudTheme[];
  activeId?: string;
  disabled: boolean;
  refreshing?: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "recent">("name");
  const filtered = useMemo(() => findThemes(themes, search, sort), [themes, search, sort]);
  return <main className="main-content module-library-page theme-library-page">
    <div className="breadcrumbs"><span>ESPACE DE TRAVAIL</span><span className="crumb-slash">/</span><strong>Mes SETS</strong></div>
    <section className="module-library-browser theme-library-browser" aria-label="Parcourir les SETS">
      <div className="module-library-tools">
        <label className="module-library-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Rechercher un SET" placeholder="Nom, artiste, musiciens, projet…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="module-library-sort"><span role="status">{filtered.length} / {themes.length} SET{themes.length === 1 ? "" : "S"}</span>
          <select aria-label="Trier les SETS" value={sort} onChange={(event) => setSort(event.target.value === "recent" ? "recent" : "name")}><option value="name">Nom · A–Z</option><option value="recent">Modifiés récemment</option></select>
          <button className="tiny-icon theme-refresh-button" type="button" onClick={onRefresh} disabled={disabled || refreshing} aria-label="Actualiser la liste des SETS" title="Actualiser la liste des SETS"><RefreshCw size={15} className={refreshing ? "spinning" : ""} aria-hidden="true" /></button>
          <button className="primary-button library-create-button" onClick={onCreate} disabled={disabled}><Plus size={15} /> Nouveau SET</button>
        </div>
      </div>
      <div className="module-library-list theme-library-list" aria-label="SETS enregistrés">
        {filtered.map((theme) => <button key={theme.id} className={`module-library-item ${theme.id === activeId ? "selected" : ""}`} disabled={disabled} onClick={() => onOpen(theme.id)}>
          <span className="module-library-card-icon"><Disc3 size={18} /></span>
          <span className="module-library-card-copy"><strong>{theme.set.name}</strong><small>{[theme.set.artist, theme.set.project].filter(Boolean).join(" · ") || "Artiste / projet non renseignés"}</small><small className="module-library-card-count">{theme.set.bpm} BPM · {theme.set.key}</small>{theme.id === activeId && <small>Session ouverte</small>}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>)}
      </div>
      {!themes.length ? <div className="module-library-no-results"><Disc3 size={24} /><strong>Crée ton premier SET</strong><p>Un SET représente le morceau complet : informations musicales, PATCHES et câblage.</p></div>
        : !filtered.length && <div className="module-library-no-results"><Search size={22} /><strong>Aucun SET trouvé</strong><p>Essaie un autre nom, artiste ou projet.</p><button className="outline-button" onClick={() => setSearch("")}>Effacer la recherche</button></div>}
    </section>
  </main>;
}
