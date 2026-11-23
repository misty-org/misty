import { execve } from "node:process";
import { resolve, basename } from "node:path";
import { signDevelopmentBinary } from "./dev_signing.ts";
import { prepareDevelopmentBundle } from "./dev_app_bundle.ts";
import { prepareDevelopmentExtension, registerDevelopmentExtension } from "./drive_extension.ts";

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
      "Missing stable macOS development signing identity; launch with `npm run tauri dev`.",
    );
  }
  const binary = resolve(executable);
  if (basename(binary) !== "misty-desktop") {
    throw new Error("The Misty development runner only signs misty-desktop.");
  }
  const app = prepareDevelopmentBundle(binary);
  const drive = prepareDevelopmentExtension(app.bundle, identity);
  signDevelopmentBinary(app.bundle, identity, drive.entitlements);
  registerDevelopmentExtension(drive.appex);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  execve(app.executable, [app.executable, ...args], environment);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
