import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

function isLocalApiBase(value?: string) {
  const apiBase = value?.trim();
  if (!apiBase) {
    return false;
  }

  try {
    const url = new URL(apiBase);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(apiBase);
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (command === "build" && mode === "production" && isLocalApiBase(env.VITE_API_BASE)) {
    throw new Error(
      "Production builds cannot use a localhost VITE_API_BASE. Set VITE_API_BASE to the deployed API URL or omit it to use /api.",
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      preserveSymlinks: true,
    },
  };
})
