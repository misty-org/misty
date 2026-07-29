import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { sites } from './build/sites-vite-plugin'

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

function apiProxyTarget(value?: string) {
  const rawTarget = value?.trim();
  if (!rawTarget) {
    return undefined;
  }

  const target = new URL(rawTarget);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "VITE_API_PROXY_TARGET must be an HTTP(S) origin without credentials, a path, query, or fragment.",
    );
  }
  return target.origin;
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = apiProxyTarget(env.VITE_API_PROXY_TARGET);
  if (command === "build" && mode === "production" && isLocalApiBase(env.VITE_API_BASE)) {
    throw new Error(
      "Production builds cannot use a localhost VITE_API_BASE. Set VITE_API_BASE to the deployed API URL or omit it to use /api.",
    );
  }

  return {
    plugins: [react(), tailwindcss(), sites()],
    server: {
      port: 5174,
      proxy: proxyTarget
        ? {
            "/api": {
              target: proxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
      preserveSymlinks: true,
    },
  };
})
