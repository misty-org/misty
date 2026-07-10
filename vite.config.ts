import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const tauriDevHost = process.env.TAURI_DEV_HOST;
const desktopDevPort = Number(process.env.MISTY_DESKTOP_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    host: tauriDevHost ?? "127.0.0.1",
    port: desktopDevPort,
    strictPort: true,
    watch: {
      ignored: ["**/dist/**", "**/src-tauri/target/**"],
    },
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: desktopDevPort,
        }
      : undefined,
  },
});
