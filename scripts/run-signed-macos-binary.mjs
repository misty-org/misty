import { spawn, spawnSync } from "node:child_process";

const [executable, ...appArgs] = process.argv.slice(2);

if (!executable) {
  console.error("The macOS development runner did not receive an executable path.");
  process.exit(2);
}

const identity = process.env.MISTY_MACOS_DEV_SIGNING_IDENTITY?.trim() || firstDevelopmentIdentity();
if (identity) {
  const signed = spawnSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      identity,
      "--identifier",
      "com.misty.desktop",
      "--timestamp=none",
      executable,
    ],
    { stdio: "inherit" },
  );
  if (signed.error || signed.status !== 0) {
    console.error(
      "Could not sign the Misty development binary. Set MISTY_MACOS_DEV_SIGNING_IDENTITY to a valid code-signing identity.",
    );
    process.exit(signed.status ?? 1);
  }
} else {
  console.warn(
    "No Apple Development identity was found. Misty will run ad-hoc signed, so macOS Keychain may ask again after rebuilds.",
  );
}

const child = spawn(executable, appArgs, {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Could not start Misty: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function firstDevelopmentIdentity() {
  if (process.platform !== "darwin") return "";
  const result = spawnSync(
    "/usr/bin/security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return "";
  const identities = [...result.stdout.matchAll(/\"([^\"]+)\"/g)].map((match) => match[1]);
  return identities.find((candidate) => candidate.startsWith("Apple Development:"))
    ?? identities.find((candidate) => candidate.startsWith("Developer ID Application:"))
    ?? "";
}
