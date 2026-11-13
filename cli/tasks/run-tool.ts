import { spawn } from "node:child_process";
import { constants } from "node:os";
import { whenStranded } from "./stranded.ts";
import { toolCommand } from "./tooling.ts";

// Tauri and the preview stop this runner, not the tool under it. Passing their signal on keeps a dev server
// from outliving the runner and holding its port.
const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function fail(error: unknown) {
  console.error(`Misty tooling: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}

try {
  const [name, ...args] = process.argv.slice(2);
  if (!name) throw new Error("Usage: npm run tool -- <name> [arguments]");
  const command = toolCommand(name, args);
  const child = spawn(command.program, command.args, {
    cwd: command.cwd,
    stdio: "inherit",
    env: process.env,
  });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  for (const signal of forwardedSignals) process.on(signal, forward);
  whenStranded(() => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
  });
  child.on("error", fail);
  child.on("exit", (code, signal) => {
    for (const forwarded of forwardedSignals) process.off(forwarded, forward);
    process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
  });
} catch (error) {
  fail(error);
}
