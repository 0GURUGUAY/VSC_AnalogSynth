import { Capacitor, CapacitorHttp } from "@capacitor/core";
import type { JackDirection, PanelAnalysis, PanelVisionAnalysis } from "./types";
import { isJackDirection, jackDirection } from "./ports";

const maxControls = 64;
const maxJacks = 40;
const cloudRunUrl = "https://analog-memory-65609223509.us-central1.run.app";

function analysisEndpoint(path = "/api/rings/analyze"): string {
  const serverUrl = import.meta.env.VITE_AI_SERVER_URL?.trim() || import.meta.env.VITE_API_URL?.trim();
  if (!serverUrl) {
    return Capacitor.isNativePlatform() ? `${cloudRunUrl}${path}` : path;
  }
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error("VITE_AI_SERVER_URL doit être une URL HTTP ou HTTPS valide.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("VITE_AI_SERVER_URL doit être une URL HTTP ou HTTPS sans identifiants, paramètres ni fragment.");
  }
  if (url.protocol !== "https:" && import.meta.env.MODE !== "mobile-local") {
    throw new Error("Le serveur IA doit utiliser HTTPS. HTTP est réservé au mode de test mobile-local.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url.href;
}

function parseServiceResponse(status: number, contentType: string, body: unknown): unknown {
  if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(contentType)) {
    throw new Error(`Le serveur IA a renvoyé une réponse non JSON (HTTP ${status}). Vérifie l’adresse du relais et que le serveur Vite est lancé ; les fichiers de l’APK ne fournissent pas ce service.`);
  }
  let result: unknown = body;
  if (typeof body === "string") {
    try {
      result = JSON.parse(body);
    } catch {
      throw new Error(`Le serveur IA a renvoyé un JSON invalide (HTTP ${status}).`);
    }
  }
  if (status < 200 || status >= 300) {
    const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
      ? result.error
      : `L’analyse a échoué (HTTP ${status}).`;
    throw new Error(message);
  }
  return result;
}

export function clockAngleToPotentiometerPercent(angleDegrees: number): number | null {
  if (!Number.isFinite(angleDegrees) || angleDegrees < 0 || angleDegrees >= 360) return null;

  const startAngle = 210;
  const sweepDegrees = 300;
  const clockwiseOffset = (angleDegrees - startAngle + 360) % 360;
  if (clockwiseOffset > sweepDegrees) return null;
  return Math.round((clockwiseOffset / sweepDegrees) * 100);
}

function isOptionalText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

function isVisionAnalysis(value: unknown): value is PanelVisionAnalysis {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const analysis = value as Record<string, unknown>;
  if (typeof analysis.summary !== "string" || analysis.summary.length > 1200) return false;
  if (!isOptionalText(analysis.model, 80) || !isOptionalText(analysis.moduleName, 80) || !isOptionalText(analysis.manufacturer, 80)) return false;
  if (!Array.isArray(analysis.controls) || analysis.controls.length > maxControls) return false;
  if (!analysis.controls.every((estimate) => {
    if (typeof estimate !== "object" || estimate === null || Array.isArray(estimate)) return false;
    const candidate = estimate as Record<string, unknown>;
    const position = candidate.positionPercent;
    return typeof candidate.label === "string" && candidate.label.trim().length > 0 && candidate.label.length <= 40
      && (candidate.kind === undefined || candidate.kind === "knob" || candidate.kind === "slider")
      && (position === undefined || position === null || (typeof position === "number" && Number.isFinite(position) && position >= 0 && position <= 100))
      && (candidate.angleDegrees === null || (typeof candidate.angleDegrees === "number" && Number.isFinite(candidate.angleDegrees) && candidate.angleDegrees >= 0 && candidate.angleDegrees < 360))
      && typeof candidate.confidence === "number"
      && Number.isFinite(candidate.confidence)
      && candidate.confidence >= 0
      && candidate.confidence <= 1;
  })) return false;
  if (!Array.isArray(analysis.jacks) || analysis.jacks.length > maxJacks) return false;
  return analysis.jacks.every((jack) => {
    if (typeof jack !== "object" || jack === null || Array.isArray(jack)) return false;
    const candidate = jack as Record<string, unknown>;
    return typeof candidate.label === "string" && candidate.label.trim().length > 0 && candidate.label.length <= 40
      && isJackDirection(candidate.direction)
      && typeof candidate.confidence === "number"
      && Number.isFinite(candidate.confidence)
      && candidate.confidence >= 0
      && candidate.confidence <= 1;
  });
}

function slugify(label: string): string {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "control";
}

export async function analyzePanelPhoto(photo: Blob, token?: string): Promise<PanelAnalysis> {
  const mimeType = photo.type.toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Format photo non pris en charge. Choisis une image JPEG, PNG ou WebP.");
  }
  if (photo.size > 8 * 1024 * 1024) {
    throw new Error("La photo dépasse la taille maximale de 8 Mo.");
  }
  const endpoint = analysisEndpoint();

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Lecture de la photo impossible."));
    reader.onerror = () => reject(new Error("Lecture de la photo impossible."));
    reader.readAsDataURL(photo);
  });
  const imageBase64 = dataUrl.split(",", 2)[1];
  if (!imageBase64) throw new Error("La photo n’a pas pu être préparée pour l’analyse.");

  const result = await postJson(endpoint, { mimeType, imageBase64 }, 70_000, token);
  if (!isVisionAnalysis(result)) throw new Error("Gemini a renvoyé des angles ou des réglages illisibles. Réessaie avec une photo plus nette.");
  const vision = result;
  const usedIds = new Set<string>();
  return {
    ...vision,
    controls: vision.controls.map((estimate) => {
      const base = slugify(estimate.label);
      let id = base;
      for (let index = 2; usedIds.has(id); index += 1) id = `${base}-${index}`;
      usedIds.add(id);
      return {
        id,
        label: estimate.label.trim(),
        kind: estimate.kind ?? "knob",
        angleDegrees: estimate.angleDegrees,
        confidence: estimate.confidence,
        value: estimate.kind === "slider"
          ? (typeof estimate.positionPercent === "number" ? Math.round(estimate.positionPercent) : null)
          : estimate.angleDegrees === null ? null : clockAngleToPotentiometerPercent(estimate.angleDegrees),
      };
    }),
    jacks: vision.jacks.map((jack, index) => ({
      id: `${slugify(jack.label)}-${index + 1}`,
      label: jack.label.trim(),
      direction: jackDirection(jack),
      confidence: jack.confidence,
    })),
  };
}

async function postJson(endpoint: string, payload: unknown, timeoutMs = 70_000, token?: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (Capacitor.isNativePlatform()) {
      // Native HTTP avoids WebView mixed-content and CORS restrictions.
      let response;
      try {
        response = await CapacitorHttp.post({
          url: endpoint,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          data: payload,
          responseType: "text",
          connectTimeout: 10_000,
          readTimeout: timeoutMs,
        });
      } catch (error) {
        throw new Error("Impossible de contacter le service IA. Vérifie que le Mac et le téléphone sont sur le même Wi-Fi, que le serveur est lancé et que son adresse est correcte.", { cause: error });
      }
      const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "";
      return parseServiceResponse(response.status, contentType, response.data);
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return parseServiceResponse(response.status, response.headers.get("content-type") ?? "", await response.text());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("L’analyse a dépassé le délai autorisé. Réessaie avec une photo plus légère.");
    }
    if (error instanceof TypeError) {
      throw new Error("Impossible de contacter le service IA. Vérifie l’adresse du service, la connexion et que le serveur est lancé.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export type HiddenJack = { label: string; direction: JackDirection; location: string };

/** Recherche (via l'IA + web) les connecteurs absents de la façade : face arrière, côtés, MIDI IN/OUT/THRU, USB, etc. */
export async function findHiddenJacks(device: { moduleName: string | null; manufacturer: string | null; visibleJacks: string[] }, token?: string): Promise<HiddenJack[]> {
  const name = [device.manufacturer, device.moduleName].filter(Boolean).join(" ").trim();
  if (!name) return [];
  const result = await postJson(analysisEndpoint("/api/rings/hidden-jacks"), { ...device, name }, 70_000, token);
  const jacks = typeof result === "object" && result !== null && "jacks" in result ? result.jacks : null;
  if (!Array.isArray(jacks)) throw new Error("La recherche des connecteurs cachés a renvoyé un résultat illisible.");
  const seen = new Set<string>();
  const known = new Set(device.visibleJacks.map((label) => label.trim().toLowerCase()));
  const out: HiddenJack[] = [];
  for (const jack of jacks.slice(0, maxJacks)) {
    if (typeof jack !== "object" || jack === null) continue;
    const { label, direction, location } = jack as Record<string, unknown>;
    if (typeof label !== "string" || !label.trim() || label.length > 40 || !isJackDirection(direction)) continue;
    const key = label.trim().toLowerCase();
    if (seen.has(key) || known.has(key)) continue;
    seen.add(key);
    out.push({ label: label.trim(), direction: jackDirection({ label, direction }), location: typeof location === "string" ? location.slice(0, 30) : "Non visible" });
  }
  return out;
}
