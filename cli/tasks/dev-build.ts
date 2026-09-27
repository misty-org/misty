import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));

export function developmentBuildEnvironment(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
  root = repository,
): NodeJS.ProcessEnv {
  if (args[0] !== "dev" || args.includes("--help") || args.includes("-h")) return {};
  const profile = environment.MISTY_DESKTOP_PROFILE ?? environment.MISTY_PROFILE;
  if (profile === undefined) return {};
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(profile)) {
    throw new Error("Invalid desktop development profile name.");
  }
  const nativeRoot = resolve(root, "src-tauri");
  const targetRoot = resolve(
    nativeRoot,
    environment.CARGO_TARGET_DIR || environment.CARGO_BUILD_TARGET_DIR || "target",
  );
  const buildRoot = environment.CARGO_BUILD_BUILD_DIR
    ? resolve(nativeRoot, environment.CARGO_BUILD_BUILD_DIR)
    : targetRoot;
  // Profile-specific Tauri configuration is compiled into the binary. Both the
  // artifacts and intermediates must be isolated, including their Cargo locks.
  return {
    CARGO_TARGET_DIR: resolve(targetRoot, "dev-profiles", profile),
    CARGO_BUILD_BUILD_DIR: resolve(buildRoot, "dev-profiles", profile),
  };
}
