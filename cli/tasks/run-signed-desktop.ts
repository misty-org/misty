import { execve } from "node:process";
import { resolve, basename } from "node:path";
import { signDevelopmentBinary } from "./dev-signing.ts";

try {
  const [executable, ...args] = process.argv.slice(2);
  const identity = process.env.MISTY_DEV_SIGNING_IDENTITY;
  if (
    process.platform !== "darwin" ||
    !executable ||
    !identity ||
    !/^[a-f0-9]{40}$/i.test(identity)
  ) {
    throw new Error(
      "Missing stable macOS development signing identity; launch with `misty desktop dev`.",
    );
  }
  const binary = resolve(executable);
  if (basename(binary) !== "misty-desktop") {
    throw new Error("The Misty development runner only signs misty-desktop.");
  }
  signDevelopmentBinary(binary, identity);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  // Replace this process so Cargo/Tauri still owns the actual app PID and can
  // stop it on the next native reload. No orphaned wrapper/child processes.
  execve(binary, [binary, ...args], environment);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
