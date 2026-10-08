import assert from "node:assert/strict";
import test from "node:test";
import { findLibraryModules, prepareThemePreset } from "../src/library.ts";

const original = {
  id: "original-preset",
  name: "Cloche",
  values: { frequency: 72 },
  notes: "Doux",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("bibliothèque : recherche multi-termes sans accents et tri sans mutation", () => {
  const modules = [
    { id: "2", name: "Module 10", manufacturer: "Émilie", model: "Analog", updatedAt: "2026-10-01" },
    { id: "1", name: "Module 2", manufacturer: "Mutable Instruments", model: "Rings", updatedAt: "2026-10-07" },
    { id: "3", name: "Basse", manufacturer: "Roland", model: "SH-101", updatedAt: "2026-10-06" },
  ];
  const snapshot = structuredClone(modules);
  assert.deepEqual(findLibraryModules(modules, "  EMILIE analog ", "name").map((item) => item.id), ["2"]);
  assert.deepEqual(findLibraryModules(modules, "rings mutable", "name").map((item) => item.id), ["1"]);
  assert.deepEqual(findLibraryModules(modules, "SH-101", "name").map((item) => item.id), ["3"]);
  assert.deepEqual(findLibraryModules(modules, "", "name").map((item) => item.id), ["3", "1", "2"]);
  assert.deepEqual(findLibraryModules(modules, " ", "recent").map((item) => item.id), ["1", "3", "2"]);
  assert.deepEqual(findLibraryModules(modules, "inexistant", "name"), []);
  assert.deepEqual(findLibraryModules([], "", "name"), []);
  assert.deepEqual(modules, snapshot);
});

test("enregistrer dans un thème avec le même nom met à jour le preset sélectionné", () => {
  for (const name of ["Cloche", "  Cloche  "]) {
    const saved = prepareThemePreset(name, { frequency: 81 }, "Modifié", original);
    assert.equal(saved.id, original.id);
    assert.equal(saved.createdAt, original.createdAt);
    assert.equal(saved.name, "Cloche");
    assert.deepEqual(saved.values, { frequency: 81 });
    assert.equal(saved.notes, "Modifié");
    assert.notEqual(saved.updatedAt, original.updatedAt);
  }
});

test("un autre nom crée un nouveau preset sans modifier l'original", () => {
  const snapshot = structuredClone(original);
  const values = { frequency: 81, level: null };
  for (const name of ["Cloche 2", "cloche"]) {
    const saved = prepareThemePreset(name, values, "Variante", original);
    assert.notEqual(saved.id, original.id);
    assert.equal(saved.name, name);
    assert.equal(saved.createdAt, saved.updatedAt);
    assert.notEqual(saved.createdAt, original.createdAt);
    assert.deepEqual(saved.values, values);
    assert.notEqual(saved.values, values);
    assert.equal(saved.notes, "Variante");
  }
  assert.deepEqual(original, snapshot);
});

test("réglages libres : nouveau preset à chaque sauvegarde et nom obligatoire", () => {
  const first = prepareThemePreset("  Libre  ", {}, "");
  const second = prepareThemePreset("Libre", {}, "");
  assert.notEqual(first.id, second.id);
  assert.equal(first.name, "Libre");
  assert.equal(first.createdAt, first.updatedAt);
  assert.throws(() => prepareThemePreset("   ", {}, "", original), /Donne un nom/);
});
