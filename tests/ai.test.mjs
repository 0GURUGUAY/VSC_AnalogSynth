import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import ts from "typescript";
import { cableOptions as jackOptions, instanceLabel } from "../src/sets.ts";

const portsSource = await readFile(new URL("../src/ports.ts", import.meta.url), "utf8");
const portsJavascript = ts.transpileModule(portsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const portsUrl = `data:text/javascript;base64,${Buffer.from(portsJavascript).toString("base64")}`;
const { jackDirection } = await import(portsUrl);
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
const midiVision = {
  ...vision,
  moduleName: "Midihub",
  manufacturer: "Blokas",
  controls: [],
  jacks: ["A", "B", "C", "D"].flatMap(port => [
    { label: `MIDI IN ${port}`, direction: "input", confidence: 0.9 },
    { label: `MIDI OUT ${port}`, direction: "output", confidence: 0.9 },
  ]),
  model: null,
};

const serverSource = await readFile(new URL("../vite-rings-ai.ts", import.meta.url), "utf8");
const serverJavascript = ts.transpileModule(serverSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace('"./src/ports.ts"', JSON.stringify(portsUrl));
const { ringsAiPlugin } = await import(`data:text/javascript;base64,${Buffer.from(serverJavascript).toString("base64")}`);

async function analyzeOnServer(analysis, { hidden = false, visibleJacks = [] } = {}) {
  const middlewares = [];
  ringsAiPlugin("test-key").configureServer({
    middlewares: { use: middleware => middlewares.push(middleware) },
  });
  let prompt;
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }],
    }), { headers: { "Content-Type": "application/json" } });
  };
  const request = Readable.from([JSON.stringify(hidden
    ? { name: "Midihub", visibleJacks }
    : { mimeType: "image/png", imageBase64: "cGhvdG8=" })]);
  request.method = "POST";
  request.url = hidden ? "/api/rings/hidden-jacks" : "/api/rings/analyze";
  request.headers = { "content-type": "application/json" };
  let body;
  const response = {
    statusCode: 0,
    setHeader() {},
    end(text) { body = JSON.parse(text); },
  };
  await middlewares[hidden ? 0 : 1](request, response, () => assert.fail("Analysis request was not handled"));
  return { status: response.statusCode, body, prompt };
}

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helperNames = new Set(["defaultControls", "facadeControls", "makeId", "createFacade"]);
const helpers = appAst.statements.filter(statement =>
  (ts.isFunctionDeclaration(statement) && helperNames.has(statement.name?.text))
  || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
    ts.isIdentifier(declaration.name) && helperNames.has(declaration.name.text))),
).map(statement => statement.getText(appAst)).join("\n");
const helperJavascript = ts.transpileModule(`${helpers}\nexport { facadeControls, createFacade };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { facadeControls, createFacade } = await import(`data:text/javascript;base64,${Buffer.from(helperJavascript).toString("base64")}`);

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

async function loadClient({ native = false, url, apiUrl, mode = "production", status = 200,
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
    .replace('"./ports"', JSON.stringify(portsUrl))
    .replaceAll("import.meta.env", JSON.stringify({ MODE: mode, VITE_AI_SERVER_URL: url, VITE_API_URL: apiUrl }));
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

test("web and mobile use the account cloud API when no dedicated AI relay is configured", async () => {
  for (const native of [false, true]) {
    const client = await loadClient({ native, apiUrl: "https://cloud.example" });
    await client.analyzePanelPhoto(new Blob(["photo"], { type: "image/jpeg" }), "test-token");
    assert.equal(client.calls[0].url, "https://cloud.example/api/rings/analyze");
    assert.equal(client.calls[0].headers.Authorization, "Bearer test-token");
  }
});

for (const native of [false, true]) {
  test(`Midihub without controls preserves all MIDI ports (${native ? "native" : "web"})`, async () => {
    const client = await loadClient({
      native, url: native ? "https://example.com" : undefined,
      body: JSON.stringify(midiVision),
    });
    const result = await client.analyze();
    assert.deepEqual(result.controls, []);
    assert.equal(result.moduleName, "Midihub");
    assert.deepEqual(result.jacks.map(({ label, direction }) => ({ label, direction })),
      midiVision.jacks.map(({ label, direction }) => ({ label, direction })));
    assert.equal(new Set(result.jacks.map(jack => jack.id)).size, 8);
  });
}

test("server accepts a MIDI-only device and instructs Gemini not to invent controls", async () => {
  const result = await analyzeOnServer(midiVision);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, midiVision);
  assert.match(result.prompt, /"controls":\[\]/);
  assert.match(result.prompt, /DIN 5 broches/);
  assert.match(result.prompt, /MIDI IN A/);
});

test("server keeps accepting existing knob analyses", async () => {
  const result = await analyzeOnServer(vision);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, vision);
});

for (const direction of ["input", "output", "bidirectional"]) {
  test(`server normalizes USB ${direction} to one bidirectional port`, async () => {
    const panel = { ...midiVision, jacks: [...midiVision.jacks, { label: "USB-C", direction, confidence: 0.9 }] };
    const result = await analyzeOnServer(panel);
    assert.equal(result.status, 200);
    assert.equal(result.body.jacks.length, 9);
    assert.deepEqual(result.body.jacks.at(-1), { label: "USB-C", direction: "bidirectional", confidence: 0.9 });
    assert.match(result.prompt, /"direction":"bidirectional"/);
    assert.match(result.prompt, /UN SEUL connecteur/);
    assert.match(result.prompt, /uniquement à l'alimentation/);
  });
}

for (const native of [false, true]) {
  test(`client accepts and normalizes USB ports (${native ? "native" : "web"})`, async () => {
    const usbPorts = [
      { label: "USB-C", direction: "bidirectional", confidence: 0.9 },
      { label: "USB HOST", direction: "input", confidence: 0.8 },
      { label: "microUSB", direction: "output", confidence: 0.8 },
    ];
    const client = await loadClient({
      native, url: native ? "https://example.com" : undefined,
      body: JSON.stringify({ ...midiVision, jacks: [...midiVision.jacks, ...usbPorts] }),
    });
    const result = await client.analyze();
    assert.equal(result.jacks.length, 11);
    assert.deepEqual(result.jacks.slice(-3).map(jack => jack.direction),
      ["bidirectional", "bidirectional", "bidirectional"]);
    assert.equal(new Set(result.jacks.map(jack => jack.id)).size, 11);
    const facade = { ...createFacade("Midihub"), moduleName: "Midihub", jacks: result.jacks };
    assert.deepEqual(jackOptions([facade], "input", "Rings").slice(-3),
      ["USB-C", "USB HOST", "microUSB"].map((port) => `${instanceLabel(facade, "Rings")} IN ${port}`));
    assert.deepEqual(jackOptions([facade], "output", "Rings").slice(-3),
      ["USB-C", "USB HOST", "microUSB"].map((port) => `${instanceLabel(facade, "Rings")} OUT ${port}`));
  });

  test(`hidden USB ports are normalized, deduplicated and kept bidirectional (${native ? "native" : "web"})`, async () => {
    const hiddenPorts = [
      { label: "USB-C", direction: "input", location: "Face arrière" },
      { label: "USB HOST", direction: "bidirectional", location: "Côté" },
      { label: "USB HOST", direction: "output", location: "Côté" },
      { label: "MIDI IN A", direction: "input", location: "Face arrière" },
      { label: "Bad direction", direction: "unknown", location: "Côté" },
    ];
    const server = await analyzeOnServer({ jacks: hiddenPorts }, { hidden: true, visibleJacks: ["MIDI IN A"] });
    assert.equal(server.status, 200);
    assert.equal(server.body.jacks.length, 4);
    assert.equal(server.body.jacks[0].direction, "bidirectional");
    assert.match(server.prompt, /UN SEUL connecteur/);
    assert.match(server.prompt, /"direction":"bidirectional"/);
    const client = await loadClient({
      native, url: native ? "https://example.com" : undefined,
      body: JSON.stringify(server.body),
    });
    const result = await client.findHiddenJacks({
      moduleName: "Midihub", manufacturer: "Blokas", visibleJacks: ["MIDI IN A"],
    });
    assert.deepEqual(result, [
      { label: "USB-C", direction: "bidirectional", location: "Face arrière" },
      { label: "USB HOST", direction: "bidirectional", location: "Côté" },
    ]);
    assert.match(client.calls[0].url, /\/api\/rings\/hidden-jacks$/);
    // Also normalize older relays that still send input/output for USB.
    const legacyClient = await loadClient({
      native, url: native ? "https://example.com" : undefined,
      body: JSON.stringify({ jacks: hiddenPorts }),
    });
    assert.deepEqual(await legacyClient.findHiddenJacks({
      moduleName: "Midihub", manufacturer: "Blokas", visibleJacks: ["MIDI IN A"],
    }), result);
  });
}

test("manually named and previously saved USB ports are patchable in both directions", () => {
  const midiPatch = { ...createFacade("MIDI"), cables: [
    { id: crypto.randomUUID(), source: "Midihub OUT MIDI A", destination: "Synth IN MIDI", color: "blue", midiChannel: 10, carriesClock: true },
  ] };
  const midiCopy = createFacade("MIDI copie", midiPatch);
  assert.equal(midiCopy.cables[0].midiChannel, 10);
  assert.equal(midiCopy.cables[0].carriesClock, true);
  assert.notEqual(midiCopy.cables[0].id, midiPatch.cables[0].id);
  for (const label of ["USB", "USB-C", "USB B", "USB MIDI", "microUSB", "MiniUSB", "usb audio"]) {
    for (const direction of ["input", "output", "bidirectional"]) {
      assert.equal(jackDirection({ label, direction }), "bidirectional");
      const facade = {
        ...createFacade("USB"),
        moduleName: "Midihub",
        jacks: [{ id: "usb-1", label, direction }],
      };
      const restored = JSON.parse(JSON.stringify(facade));
      const duplicate = createFacade("USB copie", restored);
      for (const panel of [facade, restored, duplicate]) {
        assert.deepEqual(jackOptions([panel], "input", "Rings"), [`${instanceLabel(panel, "Rings")} IN ${label}`]);
        assert.deepEqual(jackOptions([panel], "output", "Rings"), [`${instanceLabel(panel, "Rings")} OUT ${label}`]);
        assert.equal(panel.jacks.length, 1);
      }
    }
  }
  assert.equal(jackDirection({ label: "MIDI IN A", direction: "input" }), "input");
  assert.equal(jackDirection({ label: "MIDI OUT A", direction: "output" }), "output");
  assert.equal(jackDirection({ label: "BUSBOARD", direction: "input" }), "input");
});

test("bidirectional non-USB ports are also usable as inputs and outputs", async () => {
  const panel = { ...vision, jacks: [{ label: "DATA", direction: "bidirectional", confidence: 0.9 }] };
  assert.equal((await analyzeOnServer(panel)).status, 200);
  const client = await loadClient({ body: JSON.stringify(panel) });
  const result = await client.analyze();
  const facade = { ...createFacade("Data"), moduleName: "Test", jacks: result.jacks };
  assert.deepEqual(jackOptions([facade], "input", "Rings"), [`${instanceLabel(facade, "Rings")} IN DATA`]);
  assert.deepEqual(jackOptions([facade], "output", "Rings"), [`${instanceLabel(facade, "Rings")} OUT DATA`]);
});

test("a panel with no visible controls or ports remains eligible for hidden-port research", async () => {
  const panel = { ...midiVision, jacks: [] };
  const server = await analyzeOnServer(panel);
  assert.equal(server.status, 200);
  const client = await loadClient({ body: JSON.stringify(server.body) });
  const result = await client.analyze();
  assert.deepEqual(result.controls, []);
  assert.deepEqual(result.jacks, []);
});

for (const [name, changes] of [
  ["missing controls", { controls: undefined }],
  ["non-array controls", { controls: null }],
  ["too many controls", { controls: Array.from({ length: 65 }, () => vision.controls[0]) }],
  ["invalid control angle", { controls: [{ ...vision.controls[0], angleDegrees: 360 }] }],
  ["missing jacks", { jacks: undefined }],
  ["invalid MIDI port direction", { jacks: [{ ...midiVision.jacks[0], direction: "unknown" }] }],
  ["invalid MIDI port confidence", { jacks: [{ ...midiVision.jacks[0], confidence: 2 }] }],
]) {
  test(`server and client still reject ${name}`, async () => {
    const invalid = { ...midiVision, ...changes };
    const server = await analyzeOnServer(invalid);
    assert.equal(server.status, 502);
    assert.match(server.body.error, /réglages attendus/);
    const client = await loadClient({ body: JSON.stringify(invalid) });
    await assert.rejects(client.analyze(), /angles ou des réglages illisibles/);
  });
}

test("empty controls survive serialization and duplication without Rings fallback", () => {
  const facade = {
    ...createFacade("Midihub"),
    moduleName: midiVision.moduleName,
    controls: [],
    values: {},
    jacks: midiVision.jacks.map((jack, index) => ({ id: `midi-${index}`, ...jack })),
  };
  const restored = JSON.parse(JSON.stringify(facade));
  const duplicate = createFacade("Midihub copie", restored);
  for (const panel of [facade, restored, duplicate]) {
    assert.deepEqual(facadeControls(panel), []);
    assert.deepEqual(panel.values, {});
    assert.equal(jackOptions([panel], "input", "Rings").length, 4);
    assert.equal(jackOptions([panel], "output", "Rings").length, 4);
  }
  assert.notEqual(duplicate.controls, restored.controls);
  assert.equal(facadeControls(createFacade("Sans analyse")).length, 5);
  assert.deepEqual(facadeControls({ ...facade, controls: vision.controls }), vision.controls);
});

test("APK without an override uses the production Cloud Run relay", async () => {
  const client = await loadClient({ native: true });
  await client.analyze();
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].url, "https://analog-memory-65609223509.us-central1.run.app/api/rings/analyze");
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
