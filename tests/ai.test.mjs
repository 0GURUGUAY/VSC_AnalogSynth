import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/ai.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const capacitorMock = `export const Capacitor = { isNativePlatform: () => globalThis.aiTestRuntime.native };
export const CapacitorHttp = { post: options => globalThis.aiTestRuntime.post(options) };`;
const capacitorUrl = `data:text/javascript;base64,${Buffer.from(capacitorMock).toString("base64")}`;
const vision = {
  moduleName: "Test",
  manufacturer: null,
  controls: ["Frequency", "Structure", "Brightness", "Damping", "Position"]
    .map(label => ({ label, angleDegrees: 0, confidence: 0.9 })),
  jacks: [
    { label: "V/OCT", direction: "input", confidence: 0.95 },
    { label: "OUT", direction: "output", confidence: 0.9 },
  ],
  model: "Modal",
  summary: "Estimation",
};

globalThis.window = { setTimeout, clearTimeout };
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload();
    }, () => this.onerror());
  }
};
const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.window;
  delete globalThis.FileReader;
  delete globalThis.aiTestRuntime;
});

async function loadClient({ native = false, url, mode = "production", status = 200,
  contentType = "application/json", body = JSON.stringify(vision), transportError } = {}) {
  const calls = [];
  globalThis.aiTestRuntime = {
    native,
    async post(options) {
      calls.push({ transport: "native", ...options });
      if (transportError) throw transportError;
      return { status, headers: { "Content-Type": contentType }, data: body };
    },
  };
  globalThis.fetch = async (endpoint, options) => {
    calls.push({ transport: "web", url: endpoint, ...options });
    if (transportError) throw transportError;
    return new Response(body, { status, headers: { "Content-Type": contentType } });
  };
  const compiled = javascript
    .replace('"@capacitor/core"', JSON.stringify(capacitorUrl))
    .replaceAll("import.meta.env", JSON.stringify({ MODE: mode, VITE_AI_SERVER_URL: url }));
  const client = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const analyze = () => client.analyzePanelPhoto(new Blob(["photo"], { type: "image/jpeg" }));
  return { ...client, analyze, calls };
}

test("web keeps the same-origin relay and angle conversion", async () => {
  const client = await loadClient();
  const result = await client.analyze();
  assert.equal(client.calls[0].url, "/api/rings/analyze");
  assert.equal(client.calls[0].transport, "web");
  assert.equal(result.controls[0].value, 50);
  assert.deepEqual(result.jacks.map(({ label, direction }) => ({ label, direction })), [
    { label: "V/OCT", direction: "input" },
    { label: "OUT", direction: "output" },
  ]);
  assert.equal(result.jacks[0].id, "v-oct-1");
  assert.deepEqual(JSON.parse(client.calls[0].body), { mimeType: "image/jpeg", imageBase64: "cGhvdG8=" });
  assert.equal(client.clockAngleToPotentiometerPercent(210), 0);
  assert.equal(client.clockAngleToPotentiometerPercent(150), 100);
  assert.equal(client.clockAngleToPotentiometerPercent(180), null);
});

test("APK without a server fails before any request", async () => {
  const client = await loadClient({ native: true });
  await assert.rejects(client.analyze(), /VITE_AI_SERVER_URL/);
  assert.equal(client.calls.length, 0);
});

test("local APK sends the photo via native HTTP to the Mac", async () => {
  const client = await loadClient({ native: true, url: "http://192.168.8.160:5173/", mode: "mobile-local" });
  const result = await client.analyze();
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].transport, "native");
  assert.equal(client.calls[0].url, "http://192.168.8.160:5173/api/rings/analyze");
  assert.deepEqual(client.calls[0].data, { mimeType: "image/jpeg", imageBase64: "cGhvdG8=" });
  assert.equal(client.calls[0].readTimeout, 70_000);
  assert.equal(result.controls[0].value, 50);
});

test("HTTPS server base paths are preserved", async () => {
  const client = await loadClient({ native: true, url: "https://example.com/relay/" });
  await client.analyze();
  assert.equal(client.calls[0].url, "https://example.com/relay/api/rings/analyze");
});

test("native HTTP also accepts JSON already decoded by Android", async () => {
  const client = await loadClient({ native: true, url: "https://example.com", body: vision });
  const result = await client.analyze();
  assert.equal(result.controls[0].value, 50);
});

for (const native of [false, true]) {
  test(`HTML response has an explicit relay error (${native ? "native" : "web"})`, async () => {
    const client = await loadClient({
      native, url: native ? "https://example.com" : undefined,
      contentType: "text/html", body: "<!doctype html><html></html>",
    });
    await assert.rejects(client.analyze(), /réponse non JSON.*HTTP 200/);
  });
}

test("invalid JSON has a readable error, not a raw SyntaxError", async () => {
  const client = await loadClient({ body: "<!doctype html>" });
  await assert.rejects(client.analyze(), /JSON invalide/);
});

test("server errors retain their message", async () => {
  const client = await loadClient({ status: 429, body: '{"error":"Quota Gemini atteint."}' });
  await assert.rejects(client.analyze(), /Quota Gemini atteint/);
});

test("invalid vision response remains rejected", async () => {
  const client = await loadClient({ body: '{"summary":"incomplete"}' });
  await assert.rejects(client.analyze(), /angles ou des réglages illisibles/);
});

test("invalid jack direction remains rejected", async () => {
  const invalidVision = { ...vision, jacks: [{ label: "V/OCT", direction: "unknown", confidence: 0.9 }] };
  const client = await loadClient({ body: JSON.stringify(invalidVision) });
  await assert.rejects(client.analyze(), /angles ou des réglages illisibles/);
});

for (const url of ["http://192.168.8.160:5173", "not-a-url", "https://user:secret@example.com", "https://example.com?key=secret"]) {
  test(`invalid or insecure server configuration is rejected: ${url.replace("secret", "redacted")}`, async () => {
    const client = await loadClient({ native: true, url });
    await assert.rejects(client.analyze(), /HTTPS|URL HTTP/);
    assert.equal(client.calls.length, 0);
  });
}

test("native connection failures give actionable guidance", async () => {
  const client = await loadClient({ native: true, url: "https://example.com", transportError: new Error("connection refused") });
  await assert.rejects(client.analyze(), /Impossible de contacter le service IA/);
});

test("web timeout keeps its existing message", async () => {
  const client = await loadClient({ transportError: new DOMException("aborted", "AbortError") });
  await assert.rejects(client.analyze(), /délai autorisé/);
});
