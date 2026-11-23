import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEV_SIGNING_IDENTIFIER = "com.misty.desktop.development";

export function selectDevelopmentIdentity(listing: string, requested?: string): string {
  const identities = [...listing.matchAll(/^\s*\d+\) ([A-Fa-f0-9]{40}) "([^"]+)"/gm)].map(
    (match) => ({ hash: match[1], name: match[2] }),
  );
  const matches = requested
    ? identities.filter(
        ({ hash, name }) => hash.toLowerCase() === requested.toLowerCase() || name === requested,
      )
    : identities.filter(({ name }) => /^(Apple Development|Mac Developer): /.test(name));
  if (matches.length !== 1) {
    throw new Error(
      "Misty dev needs one stable macOS code-signing identity to retain Keychain access across rebuilds. " +
        "Install an Apple Development certificate in Xcode, or set MISTY_DEV_SIGNING_IDENTITY to the exact " +
        "certificate name or SHA-1 shown by `security find-identity -v -p codesigning`. " +
        "Ad-hoc signing cannot retain that trust.",
    );
  }
  return matches[0].hash;
}

export function signedDevArguments(
  args: string[],
  node: string,
  runner: string,
  targets = ["aarch64-apple-darwin", "x86_64-apple-darwin"],
): string[] {
  const separator = args.indexOf("--");
  const split = separator < 0 ? args.length : separator;
  const cargoConfig = targets.flatMap((target) => [
    "--config",
    `target.${target}.runner = [${JSON.stringify(node)}, ${JSON.stringify(runner)}]`,
  ]);
  const config = JSON.stringify({ build: { runner: { cmd: "cargo", args: cargoConfig } } });
  return [...args.slice(0, split), "--config", config, ...args.slice(split)];
}

export function prepareTauriDevelopment(args: string[]): string[] {
  if (args[0] !== "dev" || args.includes("--help") || args.includes("-h")) return args;
  if (process.platform === "win32") {
    return signedDevArguments(
      args,
      process.execPath,
      fileURLToPath(new URL("./run_windows_desktop.ts", import.meta.url)),
      ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"],
    );
  }
  if (process.platform !== "darwin") return args;
  if (args.some((arg) => arg === "--runner" || arg === "-r" || arg.startsWith("--runner="))) {
    throw new Error(
      "A custom Tauri runner would bypass Misty's stable dev signing. Use `npm run tauri -- dev`.",
    );
  }
  const listing = execFileSync("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  process.env.MISTY_DEV_SIGNING_IDENTITY = selectDevelopmentIdentity(
    listing,
    process.env.MISTY_DEV_SIGNING_IDENTITY,
  );
  return signedDevArguments(
    args,
    process.execPath,
    fileURLToPath(new URL("./run_signed_desktop.ts", import.meta.url)),
  );
}

export function signDevelopmentBinary(binary: string, identity: string, entitlements?: string): void {
  execFileSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      identity,
      "--identifier",
      DEV_SIGNING_IDENTIFIER,
      ...(entitlements ? ["--entitlements", entitlements] : []),
      "--timestamp=none",
      binary,
    ],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", binary], { stdio: "inherit" });
}
