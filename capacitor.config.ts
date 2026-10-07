import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.maxpatissier.analogmemory",
  appName: "Analog Memory",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
};

export default config;
