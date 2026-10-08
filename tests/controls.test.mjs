import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KnobControl } from "../src/KnobControl.tsx";

function renderControl(kind, value) {
  return renderToStaticMarkup(createElement(KnobControl, {
    control: { id: "frequency", label: "Frequency", hint: "Hauteur", kind },
    value,
    onChange: () => {},
  }));
}

test("contrôle partagé : bouton rotatif, échelle et valeurs extrêmes", () => {
  for (const [value, angle] of [[0, -150], [50, 0], [100, 150]]) {
    const markup = renderControl("knob", value);
    assert.match(markup, /class="knob-shell"/);
    assert.ok(markup.includes(`--knob-angle:${angle}deg`));
    assert.ok(markup.includes(`Frequency : ${value}%`));
    assert.ok(markup.includes(`value="${value}"`));
    assert.match(markup, /type="range" min="0" max="100" step="1"/);
    assert.doesNotMatch(markup, /type="number"/);
  }
});

test("contrôle partagé : fader et valeur non renseignée préservés", () => {
  const unknown = renderControl("knob", null);
  assert.match(unknown, /À saisir/);
  assert.match(unknown, /Frequency : non renseigné/);
  assert.match(unknown, /value="50"/);
  const fader = renderControl("slider", 75);
  assert.match(fader, /control-card slider-card/);
  assert.match(fader, /--fader-pos:75%/);
  assert.doesNotMatch(fader, /knob-shell/);
  assert.match(renderControl("slider", null), /fader-cap unknown/);
});

test("contrôle partagé : réglages désactivés pendant l'enregistrement", () => {
  const markup = renderToStaticMarkup(createElement(KnobControl, {
    control: { id: "frequency", label: "Frequency" },
    value: 72,
    disabled: true,
    onChange: () => {},
  }));
  assert.match(markup, /disabled=""/);
  assert.match(markup, /value="72"/);
});
