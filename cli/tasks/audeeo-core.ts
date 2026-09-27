// Vendors @audeeo/core (github.com/kannachi323/audeeo, packages/core) at one
// pinned commit into the desktop app and the agent runtime, which build in
// separate contexts. The Rust crate pins the same commit in src-tauri.
//
//   node cli/tasks/audeeo-core.ts <commit>
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = "https://github.com/kannachi323/audeeo";
export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const vendorDirs = [
  join(root, "vendor", "audeeo-core"),
  join(root, "server", "apps", "agent-runtime", "vendor", "audeeo-core"),
];

/** The commit each vendored copy was built from. */
export function vendoredRev(dir: string): string {
  return readFileSync(join(dir, "REV"), "utf8").trim();
}

/** The commit src-tauri's Cargo.toml pins for the crate. */
export function cargoRev(): string {
  const manifest = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
  return /audeeo-core\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]{7,40})"/.exec(manifest)?.[1] ?? "";
}

/** Every file in a vendored copy, relative to it, with its contents. */
export function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(path, readFileSync(join(dir, path), "utf8"));
    }
  };
  walk("");
  return files;
}

function sync(rev: string) {
  if (!/^[0-9a-f]{7,40}$/.test(rev)) throw new Error("Pass the Audeeo commit to vendor.");
  const work = mkdtempSync(join(tmpdir(), "audeeo-core-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "inherit" });
    git("init", "-q");
    git("fetch", "-q", "--depth", "1", repository, rev);
    git("checkout", "-q", "FETCH_HEAD");
    const source = join(work, "packages", "core");
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(source, "tsconfig.build.json")], { stdio: "inherit" });
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    delete manifest.scripts;
    manifest.files = ["dist", "LICENSE", "README.md"];
    for (const target of vendorDirs) {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target, { recursive: true });
      cpSync(join(source, "dist"), join(target, "dist"), { recursive: true });
      cpSync(join(source, "LICENSE"), join(target, "LICENSE"));
      cpSync(join(source, "README.md"), join(target, "README.md"));
      writeFileSync(join(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      writeFileSync(join(target, "REV"), `${rev}\n`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    sync(process.argv[2] ?? "");
  } catch (error) {
    console.error(`audeeo-core: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
