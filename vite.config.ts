import { loadEnv, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { ringsAiPlugin } from "./vite-rings-ai.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), ringsAiPlugin(env.GEMINI_API_KEY)],
    server: {
      proxy: {
        "/api": { target: "http://localhost:8080", changeOrigin: true },
      },
    },
  };
});
