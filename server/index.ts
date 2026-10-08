import path from "node:path";
import express from "express";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { OAuth2Client } from "google-auth-library";
import { createApp } from "./app";
import { createCloudStore } from "./store";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configuration manquante : ${name}`);
  return value;
}

const projectId = required("GCP_PROJECT_ID");
const clientId = required("GOOGLE_CLIENT_ID");
const bucketName = required("GCS_BUCKET");
initializeApp({ credential: applicationDefault(), projectId, storageBucket: bucketName });
const google = new OAuth2Client(clientId);
const app = createApp({
  store: createCloudStore(bucketName),
  allowedOrigins: required("ALLOWED_ORIGINS").split(",").map((origin) => origin.trim()),
  geminiApiKey: process.env.GEMINI_API_KEY,
  async verifyToken(token) {
    const ticket = await google.verifyIdToken({ idToken: token, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email_verified) throw new Error("Compte Google non vérifié.");
    return { sub: payload.sub, email: payload.email, name: payload.name };
  },
});
const dist = path.resolve("dist");
app.use(express.static(dist, { index: false, dotfiles: "deny" }));
app.get("*", (_request, response) => response.sendFile(path.join(dist, "index.html")));
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalide.");
app.listen(port, "0.0.0.0", () => console.log(`Analog Memory écoute sur le port ${port}`));
