import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const toolingRoot = fileURLToPath(new URL("../../", import.meta.url));

type Tool = {
  package?: string;
  executable?: string;
  config: string;
  requires?: string[];
  shortConfig?: string;
};

/** One config lookup for npm, the Rust CLI, and direct task invocation. */
export function toolCommand(name: string, args: string[], root = toolingRoot) {
  root = resolve(root);
  const directory = resolve(root, ".config");
  const registryPath = resolve(directory, "tooling.json");
  if (!existsSync(registryPath)) throw new Error(`Missing Misty tool registry: ${registryPath}`);
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Record<string, Tool>;
  if (!Object.hasOwn(registry, name)) {
    throw new Error(`Unknown tool "${name}". Available tools: ${Object.keys(registry).join(", ")}`);
  }
  const tool = registry[name];
  const configuration = (name: string) => {
    const path = resolve(directory, name);
    const local = relative(directory, path);
    if (
      isAbsolute(local) ||
      local === ".." ||
      local.startsWith("../") ||
      local.startsWith("..\\")
    ) {
      throw new Error(`Tool configuration must stay inside ${directory}: ${name}`);
    }
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`Missing ${name} configuration: ${path}`);
    return path;
  };
  const config = configuration(tool.config);
  for (const required of tool.requires ?? []) configuration(required);
  // Insert before the positional-only separator; filenames after it stay untouched.
  const separator = args.indexOf("--");
  const split = separator < 0 ? args.length : separator;
  if (
    args
      .slice(0, split)
      .some(
        (arg) =>
          arg === "--config" ||
          arg.startsWith("--config=") ||
          (tool.shortConfig &&
            (arg === tool.shortConfig || arg.startsWith(`${tool.shortConfig}=`))),
      )
  ) {
    throw new Error(
      `Configure ${name} in ${config}; a separate --config override is not supported.`,
    );
  }
  const toolArgs = [...args.slice(0, split), "--config", config, ...args.slice(split)];
  if (tool.executable) return { program: tool.executable, args: toolArgs, cwd: root };
  if (!tool.package) throw new Error(`No executable or package configured for ${name}.`);
  const require = createRequire(resolve(root, "package.json"));
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${tool.package}/package.json`);
  } catch {
    throw new Error(
      `Tool "${name}" requires the npm package "${tool.package}" in ${root}. Install it before running this tool.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[name];
  if (!entry) throw new Error(`Package "${tool.package}" has no CLI entry for ${name}.`);
  return {
    program: process.execPath,
    args: [
      ...process.execArgv.filter((arg) => arg.startsWith("--max-old-space-size=")),
      resolve(dirname(manifestPath), entry),
      ...toolArgs,
    ],
    cwd: root,
  };
}
