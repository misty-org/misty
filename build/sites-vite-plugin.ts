import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const staticWorker = `const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    const pathname = new URL(request.url).pathname;
    if (!acceptsHtml || pathname === "/api" || pathname.startsWith("/api/")) {
      return response;
    }

    const fallbackUrl = new URL("/index.html", request.url);
    return env.ASSETS.fetch(new Request(fallbackUrl, request));
  },
};

export default worker;
`;

/** Packages the Vite SPA as a Cloudflare Worker-compatible Sites build. */
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "misty-sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const dist = resolve(root, "dist");
      const metadataDirectory = resolve(dist, ".openai");
      const serverDirectory = resolve(dist, "server");
      const hostingConfig = resolve(root, ".openai", "hosting.json");

      await rm(metadataDirectory, { recursive: true, force: true });
      await mkdir(metadataDirectory, { recursive: true });
      await mkdir(serverDirectory, { recursive: true });
      await writeFile(resolve(serverDirectory, "index.js"), staticWorker, "utf8");

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(metadataDirectory, "hosting.json"));
      }
    },
  };
}
