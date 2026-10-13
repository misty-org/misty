import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// Windows refuses to overwrite or delete a running executable, and Cargo links
// `target/debug/misty-desktop.exe` on every native reload. Run a private copy
// so the build output is never locked, whether Tauri or an agent rebuilds it.
export function prepareDevelopmentCopy(binary: string, profile?: string) {
  const directory = join(dirname(binary), "misty-dev-run", profile ?? "default");
  mkdirSync(directory, { recursive: true });
  // Earlier runs are still locked while alive; removal of those simply fails.
  for (const entry of readdirSync(directory)) {
    try {
      rmSync(join(directory, entry), { force: true });
    } catch {
      // A copy still in use by another running instance.
    }
  }
  const executable = join(directory, `misty-desktop-${process.pid}.exe`);
  copyFileSync(binary, executable);
  return executable;
}

if (process.argv[1] && basename(process.argv[1]) === "run-windows-desktop.ts") {
  try {
    const [executable, ...args] = process.argv.slice(2);
    if (process.platform !== "win32" || !executable) {
      throw new Error("The Windows development runner is launched by `misty desktop dev`.");
    }
    const binary = resolve(executable);
    if (basename(binary) !== "misty-desktop.exe") {
      throw new Error("The Misty development runner only runs misty-desktop.exe.");
    }
    const copy = prepareDevelopmentCopy(
      binary,
      process.env.MISTY_DESKTOP_PROFILE ?? process.env.MISTY_PROFILE,
    );
    const child = spawn(copy, args, { stdio: "inherit" });
    // Windows cannot exec in place, so end the copy with this wrapper when
    // Tauri stops it for a native reload.
    const stop = () => {
      if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.on("exit", stop);
    child.on("exit", (code) => process.exit(code ?? 1));
    child.on("error", (error) => {
      console.error(error.message);
      process.exit(1);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
