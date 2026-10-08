import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { findThemes, ThemeLibrary } from "../src/ThemeLibrary.tsx";

const themes = [
  { id: "a", set: { id: "a", name: "Thème 10", artist: "Émilie", project: "Album", genre: "Ambient", tags: "live", key: "E majeur", bpm: 90 }, updatedAt: "2026-10-01", revision: 1 },
  { id: "b", set: { id: "b", name: "Thème 2", key: "A mineur", bpm: 120 }, updatedAt: "2026-10-07", revision: 2 },
];

test("thèmes : recherche multi-termes sans accents, métadonnées et tri naturel", () => {
  const snapshot = structuredClone(themes);
  for (const query of [" EMILIE album ", "ambient live", "90 majeur"]) {
    assert.deepEqual(findThemes(themes, query, "name").map((theme) => theme.id), ["a"]);
  }
  assert.deepEqual(findThemes(themes, "120 mineur", "name").map((theme) => theme.id), ["b"]);
  assert.deepEqual(findThemes(themes, "", "name").map((theme) => theme.id), ["b", "a"]);
  assert.deepEqual(findThemes(themes, "", "recent").map((theme) => theme.id), ["b", "a"]);
  assert.deepEqual(findThemes(themes, "absent", "name"), []);
  assert.deepEqual(themes, snapshot);
});

test("thèmes : cartes, état vide, navigation sans raccourci vers les modules", () => {
  const render = (items, disabled = false, refreshing = false) => renderToStaticMarkup(createElement(ThemeLibrary, {
    themes: items, activeId: "b", disabled, refreshing, onOpen: () => {}, onCreate: () => {}, onRefresh: () => {},
  }));
  const markup = render(themes);
  assert.match(markup, /Rechercher un SET/);
  assert.match(markup, /Trier les SETS/);
  assert.match(markup, /Actualiser la liste des SETS/);
  assert.match(markup, /Session ouverte/);
  assert.match(markup, /120 BPM/);
  assert.doesNotMatch(markup, /Ma bibliothèque|changeView|Ajouter un module/);
  assert.doesNotMatch(markup, /<h1|set-heading/);
  assert.match(markup, /Nouveau SET/);
  assert.match(render([]), /Crée ton premier SET/);
  assert.match(render(themes, true), /disabled=""/);
  assert.match(render(themes, false, true), /spinning/);
  assert.match(render(themes, false, true), /disabled=""/);
});
