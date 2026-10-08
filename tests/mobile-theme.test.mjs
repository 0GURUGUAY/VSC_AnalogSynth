import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileThemeFacades, MobileThemeSteps } from "../src/MobileThemeFlow.tsx";

const renderSteps = (props) => renderToStaticMarkup(createElement(MobileThemeSteps, {
  step: 1, themeAvailable: false, hasFacades: false, disabled: false, onStep: () => {}, ...props,
}));

test("mobile : trois étapes, sans accès au son avant l'ajout d'une façade", () => {
  const initial = renderSteps({});
  assert.match(initial, /Choisir un SET/);
  assert.match(initial, /Ajouter des modules/);
  assert.match(initial, /Enregistrer mon son/);
  assert.equal((initial.match(/disabled=""/g) ?? []).length, 2);
  assert.equal((renderSteps({ themeAvailable: true }).match(/disabled=""/g) ?? []).length, 1);
  const ready = renderSteps({ themeAvailable: true, hasFacades: true, step: 3 });
  assert.doesNotMatch(ready, /disabled=""/);
  assert.match(ready, /aria-current="step"[^>]*><span>3/);
});

test("mobile : la navigation est verrouillée pendant une opération audio", () => {
  const markup = renderSteps({ themeAvailable: true, hasFacades: true, disabled: true });
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 3);
});

test("mobile : ajout depuis la bibliothèque, sélection et absence d'éditeur avancé", () => {
  const props = {
    modules: [{ id: "rings", name: "Rings", manufacturer: "Mutable Instruments", model: "", updatedAt: "2026-10-08" }],
    facades: [], activeId: "", disabled: false,
    onAdd: async () => {}, onSelect: () => {}, onRemove: () => {}, onContinue: () => {},
  };
  const render = (overrides) => renderToStaticMarkup(createElement(MobileThemeFacades, { ...props, ...overrides }));
  const empty = render({});
  assert.match(empty, /Rechercher une façade/);
  assert.match(empty, /Mutable Instruments/);
  assert.match(empty, /disabled=""[^>]*>.*Passer à l&#x27;enregistrement/);
  const ready = render({ facades: [{ id: "f1", name: "Rings" }], activeId: "f1" });
  assert.match(ready, /aria-pressed="true"/);
  assert.match(ready, /Retirer la façade sélectionnée/);
  assert.doesNotMatch(ready, /disabled=""|MASTER CLOCK|Enregistrer le preset|Position des contrôles/);
  assert.match(render({ modules: [] }), /Prépare tes façades/);
  assert.match(render({ disabled: true }), /disabled=""/);
});
