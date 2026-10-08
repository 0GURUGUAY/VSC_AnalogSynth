import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { GOOGLE_CLIENT_ID } from "./cloud";
import { GoogleOAuthProvider } from "@react-oauth/google";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
