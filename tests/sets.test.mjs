import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assignModuleToPatch, cableEndpoint, cableOptions, instanceLabel, migrateSet, orderedPatchFacades, reorderPatchModule, resolveCable } from "../src/sets.ts";
import { workspaceSchema } from "../server/schema.ts";
import { SetPatches } from "../src/SetPatches.tsx";
import { PatchMap, patchMapScope } from "../src/PatchMap.tsx";
import { PatchModuleOrder } from "../src/PatchModuleOrder.tsx";

function fixture() {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  return {
    version: 2, set: { id: ids[0], name: "Morceau", bpm: 123, key: "E majeur", musicians: "Alice, Bob", masterClockFacadeId: ids[1] },
    module: { name: "Rings", manufacturer: "", activeFacadeId: ids[1], facades: ids.slice(1).map((id) => ({
      id, name: "Rings", moduleName: "Rings", createdAt: "2026-10-08T12:00:00.000Z",
      values: { frequency: 75 }, notes: "Setup", model: "", recordings: [], cables: [],
      jacks: [{ id: "out", label: "Audio", direction: "output" }, { id: "in", label: "Audio", direction: "input" }],
    })) },
  };
}

test("SET migration: stable IDs, metadata, media, setups and MIDI, without mutation", () => {
  const legacy = fixture();
  legacy.module.facades[0].recordings.push({ id: crypto.randomUUID(), name: "son.webm", mimeType: "audio/webm", durationSeconds: 2, createdAt: legacy.module.facades[0].createdAt });
  legacy.module.facades[0].midiChannel = 9;
  legacy.module.facades[0].cables.push({ id: crypto.randomUUID(), source: "Clock OUT MIDI", destination: "Rings IN MIDI", color: "blue", carriesClock: true });
  const snapshot = structuredClone(legacy);
  const migrated = migrateSet(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.patches[0].name, legacy.set.name);
  assert.deepEqual(migrated.patches[0].moduleInstanceIds, legacy.module.facades.map((facade) => facade.id));
  assert.deepEqual(migrated.set, legacy.set);
  assert.deepEqual(migrated.module.facades[0].recordings, legacy.module.facades[0].recordings);
  assert.equal(migrated.module.facades[0].cables[0].midiChannel, 9);
  assert.deepEqual(migrateSet(migrated), migrated);
  assert.deepEqual(legacy, snapshot);
  assert.equal(workspaceSchema.safeParse(migrated).success, true);
});

test("PATCH assignments: exactly one group per module and transfers preserve setups and cables", () => {
  const workspace = migrateSet(fixture());
  const id = crypto.randomUUID();
  workspace.patches.push({ id, name: "Basse", notes: "Grave", moduleInstanceIds: [] });
  const moved = assignModuleToPatch(workspace, workspace.module.facades[1].id, id);
  assert.deepEqual(moved.module, workspace.module);
  assert.equal(moved.set.masterClockFacadeId, workspace.set.masterClockFacadeId);
  assert.equal(workspaceSchema.safeParse(moved).success, true);
  assert.equal(workspace.patches[1].moduleInstanceIds.length, 0);
  assert.throws(() => assignModuleToPatch(workspace, crypto.randomUUID(), id), /introuvable/);
  for (const change of [
    (w) => w.patches[1].moduleInstanceIds.push(w.module.facades[0].id),
    (w) => w.patches[0].moduleInstanceIds.pop(),
    (w) => w.patches[0].moduleInstanceIds.push(crypto.randomUUID()),
    (w) => { w.activePatchId = crypto.randomUUID(); },
    (w) => { w.patches[1].id = w.patches[0].id; },
  ]) {
    const invalid = structuredClone(moved);
    change(invalid);
    assert.equal(workspaceSchema.safeParse(invalid).success, false);
  }
  const emptyPatch = { ...moved, activePatchId: id, patches: workspace.patches, module: { ...workspace.module, activeFacadeId: "" } };
  assert.equal(workspaceSchema.safeParse(emptyPatch).success, true);
});

test("cross-PATCH cabling: distinct identical modules, stable endpoints and global disconnected modules", () => {
  const workspace = migrateSet(fixture());
  const facades = workspace.module.facades;
  facades[1].name = "Rings A";
  facades[2].name = "Rings B";
  const outputs = cableOptions(facades, "output", "Rings");
  assert.equal(new Set(outputs).size, 3);
  const input = cableOptions(facades, "input", "Rings", facades[1].id)[0];
  const cable = { id: crypto.randomUUID(), ...resolveCable({ source: outputs[0], destination: input, color: "green", carriesClock: true }, facades, "Rings") };
  facades[1].cables.push(cable);
  const id = crypto.randomUUID();
  workspace.patches.push({ id, name: "Basse", notes: "", moduleInstanceIds: [] });
  const moved = assignModuleToPatch(workspace, facades[1].id, id);
  assert.equal(workspaceSchema.safeParse(moved).success, true);
  facades[0].moduleName = "Clock renommée";
  assert.match(cableEndpoint(cable, "source", facades, "Rings"), /Clock renommée/);
  const isolated = patchMapScope(facades, moved.patches, id, "Rings");
  assert.deepEqual(isolated.facades.map((facade) => facade.id), [facades[1].id]);
  assert.equal(isolated.cables.length, 0);
  const combined = patchMapScope(facades, [{ ...moved.patches[1], moduleInstanceIds: [facades[0].id, facades[1].id] }], id, "Rings");
  assert.deepEqual(combined.facades.map((facade) => facade.id), [facades[0].id, facades[1].id]);
  assert.equal(combined.cables.length, 1);
  const html = renderToStaticMarkup(createElement(PatchMap, {
    facades, patches: moved.patches, fallbackModule: "Rings", setName: workspace.set.name,
    bpm: 123, musicKey: workspace.set.key, masterClockFacadeId: facades[0].id,
  }));
  assert.match(html, /Basse/);
  assert.match(html, /Périmètre du plan de câblage/);
  assert.match(html, /Tout le SET/);
  assert.match(html, /Clock renommée/);
  assert.doesNotMatch(html, new RegExp(facades[2].id.slice(0, 8)));
  assert.match(html, /stroke-dasharray="7 4"/);
  const broken = structuredClone(moved);
  broken.module.facades[1].cables[0].sourceInstanceId = crypto.randomUUID();
  assert.equal(workspaceSchema.safeParse(broken).success, false);
});

test("câblage : libellés lisibles et distincts sans référence hexadécimale, avec compatibilité historique", () => {
  const facades = fixture().module.facades.slice(0, 2);
  assert.equal(instanceLabel(facades[0], "Rings"), "Rings");
  assert.equal(instanceLabel({ ...facades[0], name: "Rings copie" }, "Rings"), "Rings (Rings copie)");
  const outputs = cableOptions(facades, "output", "Rings");
  assert.deepEqual(outputs, [
    "Rings · 1 OUT Audio",
    "Rings · 2 OUT Audio",
  ]);
  const cable = resolveCable({
    source: outputs[1],
    destination: cableOptions(facades, "input", "Rings", facades[1].id)[0],
    color: "blue",
  }, facades, "Rings");
  assert.equal(cable.sourceInstanceId, facades[1].id);
  assert.equal(cable.destinationInstanceId, facades[1].id);
  assert.doesNotMatch(cableEndpoint({ id: crypto.randomUUID(), ...cable }, "source", facades, "Rings"), /[a-f\d]{8}/i);

  const legacySource = `Rings (Rings · ${facades[1].id.slice(0, 8)}) OUT Audio`;
  const migrated = resolveCable({
    source: legacySource,
    destination: "missing",
    color: "blue",
  }, facades, "Rings");
  assert.equal(migrated.sourceInstanceId, facades[1].id);
  assert.equal(cableEndpoint({ id: crypto.randomUUID(), ...migrated }, "source", facades, "Rings"), outputs[1]);
});

test("plan de câblage: les anciens noms rejoignent la façade correspondante", () => {
  const facade = fixture().module.facades[0];
  facade.moduleName = "ES-9";
  facade.name = "ES-9";
  facade.jacks = [
    { id: "input-1", label: "1 (Input)", direction: "input" },
    { id: "input-2", label: "2 (Input)", direction: "input" },
  ];
  facade.cables = [
    {
      id: crypto.randomUUID(), source: "Clock OUT 1", destination: "unused",
      color: "pink", destinationInstanceId: facade.id, destinationPortId: "input-2",
    },
    {
      id: crypto.randomUUID(), source: "Clock OUT 2", destination: "ES-9 IN 1 (Input)",
      color: "green",
    },
  ];
  const otherFacade = {
    ...structuredClone(facade), id: crypto.randomUUID(), name: "ES-9 copie", cables: [],
  };
  const label = "ES-9";
  const html = renderToStaticMarkup(createElement(PatchMap, {
    facades: [facade, otherFacade], fallbackModule: "ES-9", setName: "Session", bpm: 120, musicKey: "C",
  }));

  assert.equal((html.match(new RegExp(`<title>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`, "g")) ?? []).length, 1);
  assert.ok(html.includes(`${label} IN 1 (Input)`));
  assert.ok(html.includes(`${label} IN 2 (Input)`));
  assert.ok(html.includes("ES-9 (ES-9 copie)"));
  assert.doesNotMatch(html, /[a-f\d]{8}/i);
  assert.match(html, /1 \(Input\)/);
  assert.match(html, /2 \(Input\)/);
});

test("plan de câblage: regroupe les doublons exacts et réunit leurs ports", () => {
  const first = fixture().module.facades[0];
  first.moduleName = "ES-9";
  first.name = "ES-9";
  first.jacks = [
    { id: "input-1", label: "1 (Input)", direction: "input" },
    { id: "input-2", label: "2 (Input)", direction: "input" },
  ];
  first.cables = [{
    id: crypto.randomUUID(), source: "Clock OUT 1", destination: "ES-9 IN 1 (Input)", color: "pink",
  }];
  const second = {
    ...structuredClone(first),
    id: crypto.randomUUID(),
    jacks: [first.jacks[1]],
    cables: [{
      id: crypto.randomUUID(), source: "Clock OUT 2", destination: "unused", color: "green",
      destinationInstanceId: "", destinationPortId: "input-2",
    }],
  };
  second.cables[0].destinationInstanceId = second.id;

  const html = renderToStaticMarkup(createElement(PatchMap, {
    facades: [first, second], fallbackModule: "ES-9", setName: "Session", bpm: 120, musicKey: "C",
  }));

  assert.match(html, /Plan de câblage · 1 module/);
  assert.equal((html.match(/<title>ES-9<\/title>/g) ?? []).length, 1);
  assert.doesNotMatch(html, new RegExp(`ES-9 \\(ES-9 · (?:${first.id.slice(0, 8)}|${second.id.slice(0, 8)})\\)`));
  assert.match(html, /1 \(Input\)/);
  assert.match(html, /2 \(Input\)/);
  assert.equal((html.match(/<td>ES-9 IN [12] \(Input\)<\/td>/g) ?? []).length, 2);
});

test("PATCH UI: group selection, moves, notes, safe removal and audio navigation locking", () => {
  const workspace = migrateSet(fixture());
  workspace.patches.push({ id: crypto.randomUUID(), name: "Basse", notes: "", moduleInstanceIds: [] });
  const render = (disabled) => renderToStaticMarkup(createElement(SetPatches, { workspace, disabled, onChange() {}, onSelect() {} }));
  assert.match(render(false), /Nouveau PATCH/);
  assert.match(render(false), /Nom du PATCH/);
  assert.match(render(false), /Notes du PATCH/);
  assert.match(render(false), /conserver les modules/);
  assert.doesNotMatch(render(false), /PATCH de Rings/);
  assert.doesNotMatch(render(false), /Rings.*<select/);
  assert.match(render(true), /disabled=""/);
});

test("PATCH order: move in both directions, preserve instances, selection, cables and other patches", () => {
  const workspace = migrateSet(fixture());
  const patch = workspace.patches[0];
  const [a, b, c] = patch.moduleInstanceIds;
  const extra = { id: crypto.randomUUID(), name: "Autre PATCH", notes: "", moduleInstanceIds: [] };
  workspace.patches.push(extra);
  workspace.module.facades[1].cables.push({
    id: crypto.randomUUID(), source: "Rings OUT Audio", destination: "Rings IN Audio", color: "blue",
    sourceInstanceId: a, sourcePortId: "out", destinationInstanceId: b, destinationPortId: "in",
  });
  const snapshot = structuredClone(workspace);
  const moved = reorderPatchModule(workspace, patch.id, a, c, "after");
  assert.deepEqual(moved.patches[0].moduleInstanceIds, [b, c, a]);
  assert.equal(moved.module, workspace.module);
  assert.equal(moved.set, workspace.set);
  assert.equal(moved.activePatchId, workspace.activePatchId);
  assert.equal(moved.patches[1], extra);
  assert.deepEqual(workspace, snapshot);

  const restored = workspaceSchema.parse(JSON.parse(JSON.stringify(moved)));
  assert.deepEqual(orderedPatchFacades(restored.module.facades, restored.patches[0]).map((facade) => facade.id), [b, c, a]);
  assert.deepEqual(reorderPatchModule(moved, patch.id, a, b, "before").patches[0].moduleInstanceIds, [a, b, c]);
  assert.deepEqual(reorderPatchModule(workspace, patch.id, b, c, "after").patches[0].moduleInstanceIds, [a, c, b]);
  assert.deepEqual(reorderPatchModule(workspace, patch.id, c, b, "before").patches[0].moduleInstanceIds, [a, c, b]);
  assert.equal(reorderPatchModule(workspace, patch.id, a, a, "before"), workspace);
  assert.equal(reorderPatchModule(workspace, patch.id, a, b, "before"), workspace);
  assert.equal(reorderPatchModule(workspace, patch.id, b, a, "after"), workspace);
  assert.throws(() => reorderPatchModule(workspace, extra.id, a, b, "before"), /introuvable/);
  assert.throws(() => reorderPatchModule(workspace, patch.id, "missing", b, "before"), /introuvable/);
  assert.throws(() => reorderPatchModule(workspace, patch.id, a, "missing", "after"), /introuvable/);
  assert.throws(() => reorderPatchModule(workspace, "missing", a, b, "before"), /introuvable/);
  assert.deepEqual(orderedPatchFacades(workspace.module.facades, undefined), []);
  assert.deepEqual(orderedPatchFacades(workspace.module.facades, extra), []);
});

test("PATCH order UI: ordered cards, accessible drag handles and locking", () => {
  const workspace = migrateSet(fixture());
  workspace.module.facades.forEach((facade, index) => { facade.name = `Module ${index + 1}`; });
  workspace.patches[0].moduleInstanceIds.reverse();
  const facades = orderedPatchFacades(workspace.module.facades, workspace.patches[0]);
  const render = (disabled, members = facades) => renderToStaticMarkup(createElement(PatchModuleOrder, {
    facades: members, disabled, onMove() {},
    renderFacade: (facade) => createElement("span", null, facade.name),
  }));
  const html = render(false);
  assert.ok(html.indexOf("Module 3") < html.indexOf("Module 2"));
  assert.ok(html.indexOf("Module 2") < html.indexOf("Module 1"));
  assert.equal((html.match(/draggable="true"/g) ?? []).length, 3);
  assert.match(html, /aria-label="Déplacer Module 3"/);
  assert.match(html, /flèches gauche\/droite/);
  assert.doesNotMatch(render(true), /draggable="true"/);
  assert.equal((render(true).match(/disabled=""/g) ?? []).length, 3);
  assert.doesNotMatch(render(false, facades.slice(0, 1)), /draggable="true"/);
});
