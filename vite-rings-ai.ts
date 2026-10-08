import type { Plugin } from "vite";
import type { JackDirection, PanelVisionAnalysis as PanelAnalysis } from "./src/types.ts";
import { isJackDirection, jackDirection } from "./src/ports.ts";

const maxImageBytes = 8 * 1024 * 1024;
const maxRequestBytes = Math.ceil(maxImageBytes / 3) * 4 + 1024;
const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxControls = 64;
const maxJacks = 40;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalText(value: unknown, max: number): boolean {
  return value === null || (typeof value === "string" && value.length <= max);
}

function validateAnalysis(value: unknown): value is PanelAnalysis {
  if (!isObject(value) || typeof value.summary !== "string" || value.summary.length > 1200) return false;
  if (!isOptionalText(value.model, 80) || !isOptionalText(value.moduleName, 80) || !isOptionalText(value.manufacturer, 80)) return false;
  if (!Array.isArray(value.controls) || value.controls.length > maxControls) return false;
  if (!value.controls.every((estimate) => {
    if (!isObject(estimate)) return false;
    const angleDegrees = estimate.angleDegrees;
    const position = estimate.positionPercent;
    return typeof estimate.label === "string" && estimate.label.trim().length > 0 && estimate.label.length <= 40
      && (estimate.kind === undefined || estimate.kind === "knob" || estimate.kind === "slider")
      && (position === undefined || position === null || (typeof position === "number" && Number.isFinite(position) && position >= 0 && position <= 100))
      && (angleDegrees === null || (typeof angleDegrees === "number" && Number.isFinite(angleDegrees) && angleDegrees >= 0 && angleDegrees < 360))
      && typeof estimate.confidence === "number"
      && Number.isFinite(estimate.confidence)
      && estimate.confidence >= 0
      && estimate.confidence <= 1;
  })) return false;
  if (!Array.isArray(value.jacks) || value.jacks.length > maxJacks) return false;
  return value.jacks.every((jack) => {
    if (!isObject(jack)) return false;
    return typeof jack.label === "string" && jack.label.trim().length > 0 && jack.label.length <= 40
      && isJackDirection(jack.direction)
      && typeof jack.confidence === "number"
      && Number.isFinite(jack.confidence)
      && jack.confidence >= 0
      && jack.confidence <= 1;
  });
}

function respond(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

const hiddenJacksPrompt = (name: string, visible: string[]) => `Appareil : « ${name} » (module Eurorack, pédale d'effet, synthétiseur ou autre matériel musical). Cherche sur le web sa fiche technique ou son manuel officiel et liste TOUS ses connecteurs de signal et de contrôle qui NE SONT PAS visibles sur sa face avant/façade : face arrière, côtés, dessus caché, bus. Inclus : entrées et sorties audio, CV/gate, entrées d'expression/pédale/footswitch, MIDI IN, MIDI OUT, MIDI THRU (une seule prise DIN « MIDI OUT/THRU » doit donner deux entrées distinctes si la fiche le précise), USB MIDI/audio, sync/clock, casque, send/return. Exclus l'alimentation. Connecteurs déjà vus sur la façade, à ne pas répéter : ${visible.length ? visible.join(", ") : "aucun"}. Si tu n'es pas sûr de l'appareil ou si la fiche n'existe pas, renvoie un tableau vide ; n'invente rien.

Pour chaque port USB de données (MIDI/audio/contrôle), renvoie UN SEUL connecteur avec "direction":"bidirectional" : il sera utilisable comme IN et comme OUT dans le patch. Inclus aussi les ports USB qui fournissent à la fois des données et l'alimentation, mais exclus les ports réservés uniquement à l'alimentation. Préserve les noms distincts des ports USB.

Réponds uniquement avec du JSON : {"jacks":[{"label":"MIDI IN","direction":"input","location":"Face arrière"},{"label":"USB","direction":"bidirectional","location":"Face arrière"}]}. "direction" vaut "input", "output" ou "bidirectional". "label" fait 40 caractères maximum, "location" est par ex. "Face arrière", "Côté", "Dessus".`;

async function readSmallJson(request: import("node:http").IncomingMessage, max = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > max) throw new RangeError("too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function callGemini(apiKey: string, body: unknown): Promise<Response> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60_000);
  try {
    return await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonObject(text: string): unknown {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

type ApiKeySource = string | ((request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => string);

function hiddenJacksMiddleware(keySource: ApiKeySource) {
  return async (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, next: () => void) => {
    if (request.method !== "POST" || request.url?.split("?")[0] !== "/api/rings/hidden-jacks") {
      next();
      return;
    }
    const apiKey = typeof keySource === "string" ? keySource : keySource(request, response);
    if (!apiKey) {
      respond(response, 503, { error: "L’IA n’est pas configurée. Ajoute ta clé Gemini dans Configuration ou configure GEMINI_API_KEY sur le serveur." });
      return;
    }
    try {
      const payload = await readSmallJson(request);
      if (!isObject(payload) || typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 160
        || !Array.isArray(payload.visibleJacks) || payload.visibleJacks.length > maxJacks
        || !payload.visibleJacks.every((label) => typeof label === "string" && label.length <= 40)) {
        respond(response, 400, { error: "Requête invalide." });
        return;
      }
      const prompt = hiddenJacksPrompt(payload.name.trim().replace(/[\r\n]+/g, " "), payload.visibleJacks as string[]);
      const contents = [{ parts: [{ text: prompt }] }];
      let geminiResponse = await callGemini(apiKey, { contents, tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } });
      if (geminiResponse.status === 400) {
        geminiResponse = await callGemini(apiKey, { contents, generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
      }
      if (!geminiResponse.ok) {
        respond(response, geminiResponse.status === 429 ? 429 : 502, { error: geminiResponse.status === 429 ? "Quota Gemini atteint. Réessaie plus tard." : `Gemini a refusé la recherche (HTTP ${geminiResponse.status}).` });
        return;
      }
      const result: unknown = await geminiResponse.json();
      let text = "";
      if (isObject(result) && Array.isArray(result.candidates) && isObject(result.candidates[0]) && isObject(result.candidates[0].content) && Array.isArray(result.candidates[0].content.parts)) {
        text = result.candidates[0].content.parts.map((part) => isObject(part) && typeof part.text === "string" ? part.text : "").join("");
      }
      const parsed = extractJsonObject(text);
      if (!isObject(parsed) || !Array.isArray(parsed.jacks)) {
        respond(response, 502, { error: "Gemini a renvoyé une liste de connecteurs illisible." });
        return;
      }
      const jacks = parsed.jacks.filter((jack): jack is { label: string; direction: JackDirection; location?: unknown } => isObject(jack)
        && typeof jack.label === "string" && jack.label.trim().length > 0 && jack.label.length <= 40
        && isJackDirection(jack.direction))
        .slice(0, maxJacks)
        .map((jack) => ({ label: jack.label.trim(), direction: jackDirection(jack), location: typeof jack.location === "string" ? jack.location.slice(0, 30) : "Non visible" }));
      respond(response, 200, { jacks });
    } catch (error) {
      if (response.headersSent) return;
      respond(response, error instanceof SyntaxError || error instanceof RangeError ? 400 : 502, { error: error instanceof SyntaxError || error instanceof RangeError ? "Requête invalide." : "Impossible de joindre Gemini. Vérifie la connexion Internet du serveur." });
    }
  };
}

export function ringsAiPlugin(apiKey: string): Plugin {
  return {
    name: "rings-ai-dev-proxy",
    apply: "serve",
    configureServer(server) {
      installRingsAi(server.middlewares, apiKey);
    },
  };
}

type Middleware = (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, next: () => void) => void;

export function installRingsAi(server: { use: (middleware: Middleware) => unknown }, keySource: ApiKeySource): void {
      server.use(hiddenJacksMiddleware(keySource));
      server.use(async (request, response, next) => {
        if (request.method !== "POST" || request.url?.split("?")[0] !== "/api/rings/analyze") {
          next();
          return;
        }

        const apiKey = typeof keySource === "string" ? keySource : keySource(request, response);
        if (!apiKey) {
          respond(response, 503, { error: "L’IA n’est pas configurée. Ajoute ta clé Gemini dans Configuration ou configure GEMINI_API_KEY sur le serveur." });
          return;
        }
        if (!request.headers["content-type"]?.includes("application/json")) {
          respond(response, 415, { error: "La requête doit être au format JSON." });
          return;
        }
        const declaredLength = Number(request.headers["content-length"] ?? 0);
        if (declaredLength > maxRequestBytes) {
          respond(response, 413, { error: "La photo dépasse la taille maximale de 8 Mo." });
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        try {
          for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;
            if (receivedBytes > maxRequestBytes) {
              respond(response, 413, { error: "La photo dépasse la taille maximale de 8 Mo." });
              request.destroy();
              return;
            }
            chunks.push(buffer);
          }
          const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!isObject(payload)
            || typeof payload.mimeType !== "string"
            || !supportedMimeTypes.has(payload.mimeType)
            || typeof payload.imageBase64 !== "string"
            || payload.imageBase64.length === 0
            || payload.imageBase64.length > Math.ceil(maxImageBytes / 3) * 4
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.imageBase64)) {
            respond(response, 400, { error: "Photo invalide. Utilise une image JPEG, PNG ou WebP de 8 Mo maximum." });
            return;
          }

          const padding = payload.imageBase64.endsWith("==") ? 2 : payload.imageBase64.endsWith("=") ? 1 : 0;
          const imageSize = Math.floor(payload.imageBase64.length * 3 / 4) - padding;
          if (imageSize > maxImageBytes) {
            respond(response, 413, { error: "La photo dépasse la taille maximale de 8 Mo." });
            return;
          }

          const prompt = `Tu analyses une photo de la façade d'un appareil musical : module de synthétiseur modulaire (Eurorack ou autre), pédale d'effet, synthétiseur ou interface/routeur MIDI (ex. Midihub). Identifie le module d'après les inscriptions visibles ; si tu le reconnais, appuie-toi sur sa documentation officielle. Ne suppose pas qu'il s'agit d'un Rings.

Un appareil peut n'avoir aucun potentiomètre ni curseur et uniquement des entrées/sorties. Dans ce cas, renvoie "controls":[] ; c'est un résultat valide. N'invente jamais de contrôles. Les LED et boutons-poussoirs ne sont pas des potentiomètres.

Liste TOUS les potentiomètres visibles sur la façade : boutons rotatifs (potentiomètres et encodeurs à repère, kind="knob") ET potentiomètres linéaires / curseurs / faders (kind="slider"), dans l'ordre de lecture (haut vers bas, gauche vers droite), en utilisant le libellé imprimé sur le module (ex. "Frequency", "Cutoff"). N'inclus ni les prises jack, ni les interrupteurs, ni les LED, ni les boutons-poussoirs. Un curseur doit avoir un libellé unique : s'il partage un en-tête de section (ex. VCF → FREQ, RES), utilise le libellé imprimé au-dessus du curseur, précédé au besoin de la section (ex. "VCF FREQ"). Pour chaque bouton rotatif (kind="knob"), repère son centre et l'extrémité du trait indicateur, puis estime uniquement son ANGLE ABSOLU en degrés d'horloge, mesuré depuis 12 heures dans le sens horaire : 0°=12h, 90°=3h, 180°=6h, 270°=9h. Ne convertis jamais cet angle en pourcentage et n'estime pas une valeur sonore. Utilise le trait indicateur, pas la forme du bouton, le texte ni les graduations. Si tu ne peux pas distinguer le trait ou si la perspective/reflet rend son orientation incertaine, utilise angleDegrees=null et réduis la confiance.

Repère également TOUS les connecteurs de signal et de contrôle VISIBLES sur la photo : prises jack audio/CV/gate, MIDI IN/OUT/THRU (y compris DIN 5 broches), USB MIDI/audio, sync/clock, etc. Le champ "jacks" regroupe ces connecteurs quel que soit leur format physique. Les connecteurs cachés seront cherchés séparément ; inclus ceux des côtés ou de l'arrière s'ils sont visibles sur la photo. Pour chacun, relève son nom imprimé à proximité (sans inventer de nom ; si le libellé est illisible, indique "Connecteur 1", "Connecteur 2", etc.) et classe-le comme "input" ou "output" d'après le libellé, la fonction du module et si nécessaire sa documentation connue. Préserve les lettres/numéros distinctifs des ports (ex. "MIDI IN A", "MIDI OUT B"). N'inclus pas les connecteurs d'alimentation ou de bus. La confiance exprime la certitude du nom et du sens du signal. Garde les connecteurs dans l'ordre de lecture (haut vers bas, gauche vers droite). Si aucun connecteur n'est visible, renvoie un tableau vide.

Pour chaque curseur linéaire (kind="slider"), renseigne angleDegrees=null et positionPercent : la position de la capsule (le capuchon mobile) le long de sa course, de 0 (butée minimale : bas pour un curseur vertical, gauche pour un horizontal) à 100 (butée maximale : haut / droite). Utilise les graduations imprimées de la course (ex. 0 à 10) comme référence. Pour un bouton rotatif, renseigne positionPercent=null.

Pour chaque port USB de données (MIDI/audio/contrôle), renvoie UN SEUL connecteur dans "jacks", avec "direction":"bidirectional" : il sera utilisable comme IN et comme OUT dans le patch. Inclus les ports USB transportant à la fois des données et l'alimentation ; exclus ceux réservés uniquement à l'alimentation. Préserve les noms distincts des ports USB. "direction" vaut "input", "output" ou "bidirectional".

Le programme convertira l'angle mesuré sur l'arc mécanique : 210° (7h) = 0 %, 0° (12h) = 50 %, 150° (5h) = 100 %. La portion inférieure entre 5h et 7h est hors de l'arc utilisable : si le repère semble y pointer, angleDegrees=null.

Renseigne moduleName et manufacturer s'ils sont lisibles, sinon null. Renseigne "model" avec le mode/algorithme actif uniquement si un voyant ou un sélecteur le rend lisible, sinon null. N'infère pas le câblage à partir de la seule façade. Écris un bref résumé en français des éléments observés et des limites de lecture.

Réponds uniquement en JSON avec cette forme exacte :
{"moduleName":null,"manufacturer":null,"controls":[{"label":"Tune","kind":"knob","angleDegrees":0,"positionPercent":null,"confidence":0.0},{"label":"VCF FREQ","kind":"slider","angleDegrees":null,"positionPercent":50,"confidence":0.0}],"jacks":[{"label":"V/OCT","direction":"input","confidence":0.0}],"model":null,"summary":"..."}`;

          const abortController = new AbortController();
          const timeout = setTimeout(() => abortController.abort(), 60_000);
          let geminiResponse: Response;
          try {
            geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: payload.mimeType, data: payload.imageBase64 } },
                  ],
                }],
                  generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
              }),
              signal: abortController.signal,
            });
          } finally {
            clearTimeout(timeout);
          }

          if (!geminiResponse.ok) {
            const message = geminiResponse.status === 429
              ? "Quota Gemini atteint. Réessaie plus tard ou vérifie les limites de ton projet Google."
              : `Gemini a refusé l’analyse (HTTP ${geminiResponse.status}). Vérifie la clé et la disponibilité du modèle.`;
            respond(response, geminiResponse.status === 429 ? 429 : 502, { error: message });
            return;
          }

          const result: unknown = await geminiResponse.json();
          const candidateText = isObject(result)
            && Array.isArray(result.candidates)
            && isObject(result.candidates[0])
            && isObject(result.candidates[0].content)
            && Array.isArray(result.candidates[0].content.parts)
            && isObject(result.candidates[0].content.parts[0])
            && typeof result.candidates[0].content.parts[0].text === "string"
            ? result.candidates[0].content.parts[0].text
            : "";
          let analysis: unknown;
          try {
            analysis = JSON.parse(candidateText);
          } catch {
            respond(response, 502, { error: "Gemini a renvoyé un résultat illisible. Réessaie avec une photo plus nette." });
            return;
          }
          if (!validateAnalysis(analysis)) {
            respond(response, 502, { error: "Le résultat Gemini ne correspond pas aux réglages attendus. Réessaie." });
            return;
          }
          respond(response, 200, { ...analysis, jacks: analysis.jacks.map((jack) => ({ ...jack, direction: jackDirection(jack) })) });
        } catch (error) {
          if (response.headersSent) return;
          const message = error instanceof SyntaxError
            ? "La requête reçue est un JSON invalide."
            : error instanceof Error && error.name === "AbortError"
              ? "Gemini met trop de temps à répondre. Réessaie avec une photo plus légère."
              : "Impossible de joindre Gemini. Vérifie la connexion Internet du serveur.";
          respond(response, error instanceof SyntaxError ? 400 : 502, { error: message });
        }
      });
}
