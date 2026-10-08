import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import type { Facade, MusicPatch, PatchCable } from "./types";
import { masterClockLabel } from "./patch";
import { cableEndpoint, instanceLabel, orderedPatchFacades } from "./sets";

const COLORS: Record<string, string> = {
  pink: "#e0558c",
  blue: "#2f7fd6",
  yellow: "#d9a400",
  green: "#2e9d5f",
  white: "#8b8f85",
};

type Endpoint = { module: string; jack: string };

function parseEndpoint(value: string): Endpoint {
  const match = value.match(/^(.+?) (?:OUT|IN) (.+)$/);
  return match ? { module: match[1], jack: match[2] } : { module: value.trim() || "?", jack: "" };
}

type ModuleGroup = { label: string; facades: Facade[] };

function groupModules(facades: Facade[], fallbackModule: string): ModuleGroup[] {
  const groups = new Map<string, Facade[]>();
  facades.forEach((facade) => {
    const key = JSON.stringify([facade.moduleName ?? fallbackModule, facade.name]);
    groups.set(key, [...(groups.get(key) ?? []), facade]);
  });
  return [...groups.values()].map((members) => ({
    label: members.length > 1 ? members[0].moduleName ?? fallbackModule : instanceLabel(members[0], fallbackModule),
    facades: members,
  }));
}

function resolveModuleLabel(module: string, groups: ModuleGroup[], fallbackModule: string): string {
  const baseModule = module.replace(/ · \d+$/, "");
  const stableGroup = groups.find((group) => group.facades.some((facade) => instanceLabel(facade, fallbackModule) === baseModule));
  if (stableGroup) return stableGroup.label;

  const moduleGroups = groups.filter((group) => (group.facades[0].moduleName ?? fallbackModule) === baseModule);
  const namedGroup = moduleGroups.find((group) => group.facades.some((facade) => facade.name === baseModule));
  if (namedGroup) return namedGroup.label;
  if (moduleGroups.length === 1) return moduleGroups[0].label;

  const instanceGroups = groups.filter((group) => `${group.facades[0].moduleName ?? fallbackModule} (${group.facades[0].name})` === baseModule);
  return instanceGroups.length === 1 ? instanceGroups[0].label : module;
}

type Link = { cable: PatchCable; from: Endpoint; to: Endpoint };

export function patchMapScope(facades: Facade[], patches: MusicPatch[] | undefined, patchId: string, fallbackModule: string): { facades: Facade[]; cables: PatchCable[] } {
  const patch = patches?.find((candidate) => candidate.id === patchId);
  if (!patch) return { facades, cables: facades.flatMap((facade) => facade.cables) };

  const scopedFacades = orderedPatchFacades(facades, patch);
  const scopedIds = new Set(scopedFacades.map((facade) => facade.id));
  const allGroups = groupModules(facades, fallbackModule);
  const scopedLabels = new Set(groupModules(scopedFacades, fallbackModule).map((group) => group.label));
  const cables = facades.flatMap((facade) => facade.cables).filter((cable) =>
    (["source", "destination"] as const).every((side) => {
      const instanceId = side === "source" ? cable.sourceInstanceId : cable.destinationInstanceId;
      if (instanceId) return scopedIds.has(instanceId);
      const endpoint = parseEndpoint(cableEndpoint(cable, side, facades, fallbackModule));
      return scopedLabels.has(resolveModuleLabel(endpoint.module, allGroups, fallbackModule));
    }));
  return { facades: scopedFacades, cables };
}

const ROW = 24;
const HEAD = 28;
const CARD_W = 190;
const COL_GAP = 110;
const ROW_GAP = 22;

type Card = { module: string; inputs: string[]; outputs: string[]; layer: number; x: number; y: number; height: number };
type CardOffset = { x: number; y: number };
type CardDrag = { module: string; pointerId: number; startClientX: number; startClientY: number; cardX: number; cardY: number };

function buildTree(links: Link[], modules: string[]): { cards: Card[]; width: number; height: number } {
  const map = new Map<string, Card>();
  const get = (module: string) => {
    let card = map.get(module);
    if (!card) { card = { module, inputs: [], outputs: [], layer: 0, x: 0, y: 0, height: 0 }; map.set(module, card); }
    return card;
  };
  modules.forEach(get);
  links.forEach(({ from, to }) => {
    const out = get(from.module);
    if (!out.outputs.includes(from.jack)) out.outputs.push(from.jack);
    const inn = get(to.module);
    if (!inn.inputs.includes(to.jack)) inn.inputs.push(to.jack);
  });
  const cards = [...map.values()];
  // Niveau = plus long chemin depuis une source ; les boucles sont bornées.
  for (let pass = 0; pass < cards.length; pass += 1) {
    let changed = false;
    links.forEach(({ from, to }) => {
      const source = map.get(from.module)!;
      const target = map.get(to.module)!;
      if (source !== target && target.layer < source.layer + 1 && source.layer + 1 < cards.length) { target.layer = source.layer + 1; changed = true; }
    });
    if (!changed) break;
  }
  const layers = Math.max(...cards.map((c) => c.layer), 0) + 1;
  const columns: Card[][] = Array.from({ length: layers }, () => []);
  cards.forEach((card) => { card.height = HEAD + (card.inputs.length + card.outputs.length) * ROW + 8; columns[card.layer].push(card); });
  const heights = columns.map((col) => col.reduce((sum, c) => sum + c.height, 0) + Math.max(col.length - 1, 0) * ROW_GAP);
  const height = Math.max(...heights, 60);
  columns.forEach((col, i) => {
    let y = (height - heights[i]) / 2;
    col.forEach((card) => { card.x = i * (CARD_W + COL_GAP); card.y = y; y += card.height + ROW_GAP; });
  });
  return { cards, width: layers * CARD_W + (layers - 1) * COL_GAP, height };
}

export function PatchMap({ facades, patches, fallbackModule, setName, bpm, musicKey, masterClockFacadeId }: { facades: Facade[]; patches?: MusicPatch[]; fallbackModule: string; setName: string; bpm: number; musicKey: string; masterClockFacadeId?: string }) {
  const [scopeId, setScopeId] = useState("all");
  const [cardOffsets, setCardOffsets] = useState<Record<string, CardOffset>>({});
  const [draggingModule, setDraggingModule] = useState("");
  const drag = useRef<CardDrag | null>(null);
  const selectedPatch = patches?.find((patch) => patch.id === scopeId);
  const scope = useMemo(() => patchMapScope(facades, patches, selectedPatch?.id ?? "all", fallbackModule), [facades, patches, selectedPatch?.id, fallbackModule]);
  const moduleGroups = useMemo(() => groupModules(scope.facades, fallbackModule), [scope.facades, fallbackModule]);
  const links = useMemo<Link[]>(() => scope.cables
    .filter((cable) => cable.source && cable.destination)
    .map((original) => {
      const cable = { ...original, source: cableEndpoint(original, "source", facades, fallbackModule), destination: cableEndpoint(original, "destination", facades, fallbackModule) };
      const from = parseEndpoint(cable.source);
      const to = parseEndpoint(cable.destination);
      const normalizedFrom = { ...from, module: resolveModuleLabel(from.module, moduleGroups, fallbackModule) };
      const normalizedTo = { ...to, module: resolveModuleLabel(to.module, moduleGroups, fallbackModule) };
      return {
        cable: {
          ...cable,
          source: from.jack ? `${normalizedFrom.module} OUT ${from.jack}` : cable.source,
          destination: to.jack ? `${normalizedTo.module} IN ${to.jack}` : cable.destination,
        },
        from: normalizedFrom,
        to: normalizedTo,
      };
    }), [facades, scope.cables, fallbackModule, moduleGroups]);

  const tree = useMemo(() => buildTree(links, moduleGroups.map((group) => group.label)), [links, moduleGroups]);
  const cards = tree.cards.map((card) => ({
    ...card,
    x: card.x + (cardOffsets[card.module]?.x ?? 0),
    y: card.y + (cardOffsets[card.module]?.y ?? 0),
  }));
  const byName = new Map(cards.map((card) => [card.module, card]));
  const bounds = cards.reduce((current, card) => ({
    left: Math.min(current.left, card.x),
    top: Math.min(current.top, card.y),
    right: Math.max(current.right, card.x + CARD_W),
    bottom: Math.max(current.bottom, card.y + card.height),
  }), { left: 0, top: 0, right: tree.width, bottom: tree.height });
  const viewBox = `${bounds.left - 12} ${bounds.top - 12} ${bounds.right - bounds.left + 24} ${bounds.bottom - bounds.top + 24}`;

  const outPoint = (e: Endpoint) => {
    const card = byName.get(e.module)!;
    return { x: card.x + CARD_W, y: card.y + HEAD + (card.inputs.length + card.outputs.indexOf(e.jack)) * ROW + ROW / 2 };
  };
  const inPoint = (e: Endpoint) => {
    const card = byName.get(e.module)!;
    return { x: card.x, y: card.y + HEAD + card.inputs.indexOf(e.jack) * ROW + ROW / 2 };
  };

  function moveCard(event: ReactPointerEvent<SVGGElement>, card: Card) {
    if (event.type === "pointerdown") {
      if (event.button !== 0) return;
      drag.current = { module: card.module, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, cardX: card.x, cardY: card.y };
      setDraggingModule(card.module);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.type === "pointermove" && drag.current?.pointerId === event.pointerId) {
      const svg = event.currentTarget.ownerSVGElement;
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const position = point.matrixTransform(matrix.inverse());
      const currentDrag = drag.current;
      point.x = currentDrag.startClientX;
      point.y = currentDrag.startClientY;
      const start = point.matrixTransform(matrix.inverse());
      const baseCard = tree.cards.find((item) => item.module === currentDrag.module);
      setCardOffsets((current) => ({
        ...current,
        [currentDrag.module]: {
          x: currentDrag.cardX + position.x - start.x - (baseCard?.x ?? 0),
          y: currentDrag.cardY + position.y - start.y - (baseCard?.y ?? 0),
        },
      }));
    }
  }

  function finishCardDrag(event: ReactPointerEvent<SVGGElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraggingModule("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function nudgeCard(module: string, dx: number, dy: number) {
    setCardOffsets((current) => ({
      ...current,
      [module]: { x: (current[module]?.x ?? 0) + dx, y: (current[module]?.y ?? 0) + dy },
    }));
  }

  return (
    <div className="patch-map-sheet">
      <div className="patch-map-title">
        <div><strong>{setName || "Sans titre"}</strong><span>Plan de câblage{selectedPatch ? ` · ${selectedPatch.name}` : ""} · {moduleGroups.length} module{moduleGroups.length > 1 ? "s" : ""}</span></div>
        <span>{bpm} BPM · {musicKey}</span>
      </div>
      {patches && patches.length > 0 && <div className="patch-map-scope" role="group" aria-label="Périmètre du plan de câblage">
        <span>Afficher :</span>
        <button type="button" aria-pressed={!selectedPatch} onClick={() => { setScopeId("all"); setCardOffsets({}); }}>Tout le SET</button>
        {patches.map((patch) => <button key={patch.id} type="button" aria-pressed={selectedPatch?.id === patch.id}
          onClick={() => { setScopeId(patch.id); setCardOffsets({}); }}>{patch.name}</button>)}
      </div>}
      <div className="patch-map-midi">
        <strong>MASTER CLOCK</strong>
        <span>{masterClockLabel(facades, masterClockFacadeId, fallbackModule)} · {bpm} BPM</span>
        <span>{selectedPatch ? `Câbles du PATCH « ${selectedPatch.name} » uniquement.` : "Canaux MIDI et diffusion de l'horloge par liaison ci-dessous."} Configuration uniquement, sans envoi MIDI.</span>
        {!masterClockFacadeId && links.some(({ cable }) => cable.carriesClock) && <span>Attention : diffusion d'horloge sans maître défini.</span>}
      </div>
      {!selectedPatch && patches && <div className="patch-map-groups">{patches.map((patch) => <p key={patch.id}><strong>{patch.name}</strong> · {patch.moduleInstanceIds.map((id) => facades.find((facade) => facade.id === id)?.name).filter(Boolean).join(", ") || "Aucun module"}</p>)}</div>}
      {scope.facades.length === 0 && links.length === 0 && !patches?.length ? (
        <p className="patch-map-empty">Aucun module pour le moment. Ajoute des modules à un PATCH pour voir le SET ici.</p>
      ) : (
        <>
          <div className="patch-map-controls">
            <span>Glisse les modules pour les déplacer. Au clavier : sélectionne un module, puis utilise les flèches (Maj pour un déplacement plus grand).</span>
            <div className="patch-map-actions">
              <button type="button" className="patch-map-reset" onClick={() => setCardOffsets({})} disabled={Object.keys(cardOffsets).length === 0}><RotateCcw size={13} /> Réinitialiser la disposition</button>
            </div>
          </div>
          {scope.facades.length === 0 && links.length === 0 && <p className="patch-map-empty">Aucun module dans ce PATCH.</p>}
          <svg className="patch-map-svg" viewBox={viewBox} role="group" aria-label="Plan de câblage entre les modules">
            {links.map(({ cable, from, to }, i) => {
              const a = outPoint(from);
              const b = inPoint(to);
              const dx = Math.max(Math.abs(b.x - a.x) / 2, 40);
              const color = COLORS[cable.color] ?? COLORS.pink;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return <g key={cable.id}>
                <title>{`${cable.source} → ${cable.destination} · ${cable.midiChannel ? `Canal MIDI ${cable.midiChannel}` : "Canal MIDI non défini"} · ${cable.carriesClock ? "Diffusion MASTER CLOCK" : "Sans horloge"}`}</title>
                <path d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`} fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={cable.carriesClock ? "7 4" : undefined} />
                <circle cx={mx} cy={my} r={9} fill="#fff" stroke={color} strokeWidth={1.8} />
                <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1d1f1a">{i + 1}</text>
              </g>;
            })}
            {cards.map((card) => (
              <g key={card.module} transform={`translate(${card.x},${card.y})`} className={`patch-map-card${draggingModule === card.module ? " dragging" : ""}`}
                role="group" tabIndex={0} aria-label={`Module ${card.module}. Utilisez les flèches pour le déplacer.`}
                onPointerDown={(event) => moveCard(event, card)}
                onPointerMove={(event) => moveCard(event, card)}
                onPointerUp={finishCardDrag}
                onPointerCancel={finishCardDrag}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 80 : 24;
                  const moves: Record<string, [number, number]> = {
                    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
                  };
                  const offset = moves[event.key];
                  if (offset) {
                    event.preventDefault();
                    nudgeCard(card.module, offset[0], offset[1]);
                  }
                }}>
                <title>{card.module}</title>
                <rect width={CARD_W} height={card.height} rx={6} fill="#f7f6f1" stroke="#2a2d26" strokeWidth={1.3} />
                <path d={`M0,${HEAD} V6 a6,6 0 0 1 6,-6 H${CARD_W - 6} a6,6 0 0 1 6,6 V${HEAD} Z`} fill="#2a2d26" />
                <text x={12} y={HEAD / 2 + 4} fill="#f4f3ec" fontSize={12} fontWeight={700}>{card.module.length > 25 ? `${card.module.slice(0, 22)}…` : card.module}</text>
                {card.inputs.map((jack, i) => {
                  const cy = HEAD + i * ROW + ROW / 2;
                  return <g key={`in-${jack}`}><circle cx={0} cy={cy} r={5.5} fill="#fff" stroke="#2a2d26" strokeWidth={1.6} /><text x={14} y={cy + 4} fontSize={11} fill="#1d1f1a">{jack || "—"}</text></g>;
                })}
                {card.outputs.map((jack, i) => {
                  const cy = HEAD + (card.inputs.length + i) * ROW + ROW / 2;
                  return <g key={`out-${jack}`}><circle cx={CARD_W} cy={cy} r={5.5} fill="#2a2d26" stroke="#2a2d26" strokeWidth={1.6} /><text x={CARD_W - 14} y={cy + 4} textAnchor="end" fontSize={11} fill="#1d1f1a">{jack || "—"}</text></g>;
                })}
              </g>
            ))}
          </svg>
          <table className="patch-map-table">
            <thead><tr><th>#</th><th>Sortie</th><th>Entrée</th><th>Câble</th><th>Canal MIDI</th><th>MASTER CLOCK</th></tr></thead>
            <tbody>{links.map(({ cable }, i) => <tr key={cable.id}>
              <td>{i + 1}</td><td>{cable.source}</td><td>{cable.destination}</td>
              <td><span className="patch-dot" style={{ background: COLORS[cable.color] ?? COLORS.pink }} />{({ pink: "Rose", blue: "Bleu", yellow: "Jaune", green: "Vert", white: "Blanc" } as Record<string, string>)[cable.color] ?? cable.color}</td>
              <td>{cable.midiChannel ? `Canal ${cable.midiChannel}` : "Non défini / sans MIDI"}</td>
              <td>{cable.carriesClock ? "Diffusé" : "Non diffusé"}</td>
            </tr>)}</tbody>
          </table>
        </>
      )}
      {links.some(({ cable }) => cable.carriesClock) && <small className="patch-map-foot">Traits pointillés : liaisons diffusant le MASTER CLOCK.</small>}
      <small className="patch-map-foot">{fallbackModule} · généré par Analog Memory</small>
    </div>
  );
}
