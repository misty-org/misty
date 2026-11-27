import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const appRoot = join(root, "src/app");

const MB = 1024 * 1024;

export const budgets = {
  windows: {
    main: 2.6 * MB,
    companion: 0.78 * MB,
    desktop: 0.58 * MB,
    pet: 0.56 * MB,
  },
};

const windows: Record<keyof typeof budgets.windows, { html: string; eager: string[] }> = {
  main: {
    html: "index.html",
    eager: ["src/app/App.tsx", "src/app/layouts/DesktopLayout/index.tsx", "src/styles/styles.css"],
  },
  companion: { html: "companion.html", eager: [] },
  desktop: { html: "desktop.html", eager: [] },
  pet: { html: "pet.html", eager: [] },
};

interface ManifestChunk {
  file: string;
  src?: string;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
type Manifest = Record<string, ManifestChunk>;

export interface WindowSize {
  name: string;
  bytes: number;
  files: string[];
}

function keyOf(manifest: Manifest, chunks: Record<string, string>, source: string): string {
  const wanted = relative(appRoot, join(root, source));
  const own = Object.keys(manifest).find((candidate) => candidate === wanted);
  if (own) return own;
  const file = chunks[join(root, source)];
  const shared =
    file && Object.keys(manifest).find((candidate) => manifest[candidate].file === file);
  if (!shared) throw new Error(`The build has no chunk for ${source}.`);
  return shared;
}

function startupFiles(
  manifest: Manifest,
  chunks: Record<string, string>,
  page: string,
  eager: string[],
): Set<string> {
  const scripts = [...page.matchAll(/<script[^>]*\ssrc="\/?([^"]+)"/g)].map((found) => found[1]);
  const entries = Object.keys(manifest).filter((key) => scripts.includes(manifest[key].file));
  if (!entries.length) throw new Error("A page of the build loads no chunk the manifest knows.");
  const roots = entries.flatMap((key) => [key, ...(manifest[key].dynamicImports ?? [])]);
  for (const source of eager) roots.push(keyOf(manifest, chunks, source));
  const seen = new Set<string>();
  const files = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const next of chunk.imports ?? []) visit(next);
  };
  for (const key of roots) {
    visit(key);
    for (const next of manifest[key]?.dynamicImports ?? [])
      if (manifest[next]?.file.endsWith(".css")) visit(next);
  }
  return files;
}

async function packagesIn(file: string): Promise<string[]> {
  const map = await readFile(`${file}.map`, "utf8").catch(() => "");
  if (!map) return [];
  const { sources = [], sourcesContent = [] } = JSON.parse(map) as {
    sources?: string[];
    sourcesContent?: (string | null)[];
  };
  const sizes = new Map<string, number>();
  sources.forEach((source, index) => {
    const found = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(source);
    const name = found
      ? found[1]
      : (/src\/(features\/[^/]+|app|shared|api)/.exec(source)?.[1] ?? "other");
    sizes.set(name, (sizes.get(name) ?? 0) + (sourcesContent[index]?.length ?? 0));
  });
  return [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, bytes]) => `${name} ${Math.round(bytes / 1024)} kB`);
}

const chunksFile = ".vite/chunks.json";

export function chunkMap(outDir: string): Plugin {
  return {
    name: "misty-bundle-chunks",
    apply: "build",
    async writeBundle(_options, bundle) {
      const chunks: Record<string, string> = {};
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of output.moduleIds) chunks[id.split("?")[0]] = output.fileName;
      await mkdir(join(outDir, ".vite"), { recursive: true });
      await writeFile(join(outDir, chunksFile), JSON.stringify(chunks));
    },
  };
}

export async function measure(outDir: string) {
  const manifest = JSON.parse(
    await readFile(join(outDir, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const chunks = JSON.parse(
    await readFile(join(outDir, chunksFile), "utf8").catch(() => "{}"),
  ) as Record<string, string>;
  const sizes: WindowSize[] = [];
  for (const [name, { html, eager }] of Object.entries(windows)) {
    const page = await readFile(join(outDir, html), "utf8");
    const files = [...startupFiles(manifest, chunks, page, eager)];
    let bytes = 0;
    for (const file of files) bytes += (await stat(join(outDir, file))).size;
    sizes.push({ name, bytes, files });
  }
  return { sizes };
}

const shown = (bytes: number) => `${(bytes / MB).toFixed(2)} MB`;

async function explain(outDir: string, window: WindowSize): Promise<string[]> {
  const lines: string[] = [];
  const largest = await Promise.all(
    window.files.map(async (file) => ({ file, bytes: (await stat(join(outDir, file))).size })),
  );
  largest.sort((a, b) => b.bytes - a.bytes);
  for (const { file, bytes } of largest.slice(0, 5)) {
    const packages = await packagesIn(join(outDir, file));
    lines.push(
      `    ${file} ${Math.round(bytes / 1024)} kB${packages.length ? `: ${packages.join(", ")}` : ""}`,
    );
  }
  return lines;
}

export async function checkBudget(): Promise<string[]> {
  const outDir = await mkdtemp(join(tmpdir(), "misty-bundle-"));
  try {
    await build({
      configFile: join(root, ".config/vite.config.ts"),
      mode: "desktop",
      logLevel: "error",
      build: { outDir, emptyOutDir: true, manifest: true, sourcemap: true },
      plugins: [chunkMap(outDir)],
    });
    const { sizes } = await measure(outDir);
    const problems: string[] = [];
    for (const window of sizes) {
      const limit = budgets.windows[window.name as keyof typeof budgets.windows];
      console.log(
        `${window.name} window: ${shown(window.bytes)} at startup (budget ${shown(limit)})`,
      );
      if (window.bytes > limit)
        problems.push(
          `The ${window.name} window loads ${shown(window.bytes)} before it draws, over its ${shown(limit)} budget. Its largest files:`,
          ...(await explain(outDir, window)),
        );
    }
    return problems;
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  const problems = await checkBudget();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
