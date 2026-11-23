import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const appRoot = join(root, "src/app");

const MB = 1024 * 1024;

export const budgets = {
  windows: {
    main: 3.2 * MB,
    companion: 0.78 * MB,
    desktop: 0.58 * MB,
    pet: 0.56 * MB,
  },
  total: 26 * MB,
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

function keyOf(manifest: Manifest, source: string): string {
  const wanted = relative(appRoot, join(root, source));
  const key = Object.keys(manifest).find((candidate) => candidate === wanted);
  if (!key) throw new Error(`The build has no chunk for ${source}.`);
  return key;
}

function startupFiles(manifest: Manifest, page: string, eager: string[]): Set<string> {
  const scripts = [...page.matchAll(/<script[^>]*\ssrc="\/?([^"]+)"/g)].map((found) => found[1]);
  const entries = Object.keys(manifest).filter((key) => scripts.includes(manifest[key].file));
  if (!entries.length) throw new Error("A page of the build loads no chunk the manifest knows.");
  const roots = entries.flatMap((key) => [key, ...(manifest[key].dynamicImports ?? [])]);
  for (const source of eager) roots.push(keyOf(manifest, source));
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

async function walk(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)],
    ),
  );
  return files.flat();
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

export async function measure(outDir: string) {
  const manifest = JSON.parse(
    await readFile(join(outDir, ".vite/manifest.json"), "utf8"),
  ) as Manifest;
  const sizes: WindowSize[] = [];
  for (const [name, { html, eager }] of Object.entries(windows)) {
    const page = await readFile(join(outDir, html), "utf8");
    const files = [...startupFiles(manifest, page, eager)];
    let bytes = 0;
    for (const file of files) bytes += (await stat(join(outDir, file))).size;
    sizes.push({ name, bytes, files });
  }
  let total = 0;
  for (const file of await walk(outDir))
    if (!file.endsWith(".map") && !file.includes(`${join(outDir, ".vite")}`))
      total += (await stat(file)).size;
  return { sizes, total };
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
    });
    const { sizes, total } = await measure(outDir);
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
    console.log(`All of the app's frontend: ${shown(total)} (budget ${shown(budgets.total)})`);
    if (total > budgets.total)
      problems.push(
        `The app's frontend is ${shown(total)}, over its ${shown(budgets.total)} budget.`,
      );
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
