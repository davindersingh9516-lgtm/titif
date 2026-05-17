import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tiffin.app",
  appName: "Tiffin",
  webDir: "dist-mobile",
  android: {
    allowMixedContent: false,
    captureInput: false,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    Keyboard: {
      resize: "native",
    },
  },
};

export default config;
