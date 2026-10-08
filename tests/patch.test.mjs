import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { migratePatchMidi, clearRemovedMasterClock, masterClockLabel } from "../src/patch.ts";
import { workspaceSchema } from "../server/schema.ts";
import { PatchMidiSettings } from "../src/PatchMidiSettings.tsx";
import { PatchMap } from "../src/PatchMap.tsx";

const masterId = "22345678-1234-4234-8234-123456789012";
const destinationId = "32345678-1234-4234-8234-123456789012";
function fixture() {
  return {
    version: 2,
    set: { id: "12345678-1234-4234-8234-123456789012", name: "Session", bpm: 120, key: "C majeur", masterClockFacadeId: masterId },
    module: {
      name: "Rings", manufacturer: "", activeFacadeId: destinationId,
      facades: [
        { id: masterId, name: "Maître", moduleName: "Midihub", createdAt: "2026-10-07T12:00:00.000Z", values: {}, model: "", notes: "", recordings: [], cables: [] },
        { id: destinationId, name: "Synthé", createdAt: "2026-10-07T12:00:00.000Z", values: {}, model: "", notes: "", recordings: [], cables: [
          { id: crypto.randomUUID(), source: "Midihub OUT MIDI A", destination: "Rings IN MIDI 1", color: "blue", midiChannel: 1, carriesClock: true },
          { id: crypto.randomUUID(), source: "Midihub OUT MIDI B", destination: "Rings IN MIDI 2", color: "green", midiChannel: 16, carriesClock: false },
          { id: crypto.randomUUID(), source: "Midihub OUT MIDI C", destination: "Rings IN USB", color: "white", carriesClock: true },
        ] },
      ],
    },
  };
}

test("migration MIDI : canaux par ligne, absence, idempotence et pas de mutation", () => {
  const workspace = fixture();
  const facade = workspace.module.facades[1];
  facade.midiChannel = 7;
  const original = structuredClone(workspace);
  const migrated = migratePatchMidi(workspace);
  assert.deepEqual(migrated.module.facades[1].cables.map((cable) => cable.midiChannel), [1, 16, 7]);
  assert.equal("midiChannel" in migrated.module.facades[1], false);
  assert.deepEqual(migrated, migratePatchMidi(migrated));
  assert.deepEqual(workspace, original);
  delete migrated.module.facades[1].cables[2].midiChannel;
  assert.equal(migratePatchMidi(migrated).module.facades[1].cables[2].midiChannel, undefined);
  const current = fixture();
  assert.deepEqual(migratePatchMidi(current), current);
});

test("contrat cloud : canaux 1..16 indépendants, clock sans canal et maître existant", () => {
  const workspace = fixture();
  assert.deepEqual(workspaceSchema.parse(workspace), workspace);
  for (const invalid of [0, 17, 1.5, "2", null]) {
    const changed = structuredClone(workspace);
    changed.module.facades[1].cables[0].midiChannel = invalid;
    assert.equal(workspaceSchema.safeParse(changed).success, false);
  }
  const invalidClock = structuredClone(workspace);
  invalidClock.module.facades[1].cables[0].carriesClock = "true";
  assert.equal(workspaceSchema.safeParse(invalidClock).success, false);
  const absentMaster = structuredClone(workspace);
  absentMaster.set.masterClockFacadeId = crypto.randomUUID();
  assert.equal(workspaceSchema.safeParse(absentMaster).success, false);
  const multipleMasters = structuredClone(workspace);
  multipleMasters.set.masterClockFacadeId = [masterId, destinationId];
  assert.equal(workspaceSchema.safeParse(multipleMasters).success, false);
  const legacy = structuredClone(workspace);
  legacy.module.facades[1].midiChannel = 5;
  assert.deepEqual(workspaceSchema.parse(legacy).module.facades[1].cables.map((cable) => cable.midiChannel), [1, 16, 5]);
});

test("MASTER CLOCK : renommage, duplication, suppression et routes conservées", () => {
  const workspace = fixture();
  assert.equal(masterClockLabel(workspace.module.facades, masterId, "Rings"), "Midihub · Maître");
  workspace.module.facades[0].name = "Horloge";
  assert.equal(masterClockLabel(workspace.module.facades, masterId, "Rings"), "Midihub · Horloge");
  workspace.module.facades.push({ ...workspace.module.facades[0], id: crypto.randomUUID() });
  assert.equal(workspaceSchema.parse(workspace).set.masterClockFacadeId, masterId);
  assert.deepEqual(clearRemovedMasterClock(workspace, destinationId), workspace.set);
  workspace.set = clearRemovedMasterClock(workspace, masterId);
  workspace.module.facades = workspace.module.facades.filter((facade) => facade.id !== masterId);
  assert.equal(workspace.set.masterClockFacadeId, undefined);
  assert.equal(workspace.module.facades[0].cables[0].carriesClock, true);
  assert.equal(workspaceSchema.safeParse(workspace).success, true);
  assert.equal(masterClockLabel(workspace.module.facades, masterId, "Rings"), "Non défini");
});

test("réglages communs web/mobile : canal indépendant et clock cochée même sans canal", () => {
  const cable = fixture().module.facades[1].cables[2];
  const html = renderToStaticMarkup(createElement(PatchMidiSettings, { cable, label: "du câble 3", onChange() {} }));
  assert.match(html, /aria-label="Canal MIDI du câble 3"/);
  assert.match(html, /<option value="" selected="">Non défini \/ sans MIDI/);
  assert.equal((html.match(/<option/g) ?? []).length, 17);
  assert.match(html, /value="16"/);
  assert.match(html, /type="checkbox"[^>]+checked=""/);
});

test("plan imprimable : maître, canaux par ligne, diffusion et avertissement sans maître", () => {
  const workspace = fixture();
  const props = { facades: workspace.module.facades, fallbackModule: "Rings", setName: workspace.set.name, bpm: 120, musicKey: "C majeur", masterClockFacadeId: masterId };
  const html = renderToStaticMarkup(createElement(PatchMap, props));
  assert.match(html, /Midihub · Maître · 120 BPM/);
  assert.match(html, /<th>Canal MIDI<\/th><th>MASTER CLOCK<\/th>/);
  assert.match(html, /<td>Canal 1<\/td><td>Diffusé<\/td>/);
  assert.match(html, /<td>Canal 16<\/td><td>Non diffusé<\/td>/);
  assert.match(html, /<td>Non défini \/ sans MIDI<\/td><td>Diffusé<\/td>/);
  assert.equal((html.match(/stroke-dasharray="7 4"/g) ?? []).length, 2);
  assert.match(renderToStaticMarkup(createElement(PatchMap, { ...props, masterClockFacadeId: undefined })), /diffusion d&#x27;horloge sans maître défini/);
});
