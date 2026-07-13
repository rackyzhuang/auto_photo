import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { autophotoDevAiBridge } from "./vite.dev-ai-bridge.mjs";

const mobileDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), autophotoDevAiBridge()],
  server: {
    host: mobileDevHost ?? "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: mobileDevHost
      ? {
          protocol: "ws",
          host: mobileDevHost,
          port: 5173
        }
      : undefined
  }
});
