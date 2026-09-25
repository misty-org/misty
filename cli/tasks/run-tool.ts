import { spawnSync } from "node:child_process";
import { toolCommand } from "./tooling.ts";

try {
  const [name, ...args] = process.argv.slice(2);
  if (!name) throw new Error("Usage: misty tool <name> [arguments]");
  const command = toolCommand(name, args);
  const result = spawnSync(command.program, command.args, {
    cwd: command.cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Misty tooling: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
