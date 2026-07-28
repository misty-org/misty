import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Largest first: ic10 and ic14 are both 1024px, the rest descend from 512px.
const PNG_VARIANTS = ["ic10", "ic14", "ic09", "ic13", "ic08", "ic07", "ic12", "ic11"];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  argumentValue("--source") ?? join(homedir(), ".misty", "assets", "icons", "misty-logo.icns"),
);
const bundleIcns = join(appDir, "src-tauri", "icons", "icon.icns");

if (!existsSync(source)) {
  throw new Error(`Misty app icon was not found at ${source}`);
}

// `tauri icon` only accepts a raster image, so pull the largest PNG variant out
// of the .icns and drive the generator from that.
const workDir = mkdtempSync(join(tmpdir(), "misty-icons-"));
try {
  const master = join(workDir, "misty-icon.png");
  const { type, png } = largestPngVariant(readFileSync(source));
  writeFileSync(master, png);
  console.log(`Extracted ${type} (${png.length} bytes) from ${source}`);

  run(join(appDir, "node_modules", ".bin", "tauri"), ["icon", master]);

  // Prefer the authored .icns over the generated one: it carries the small
  // hand-tuned variants (ic04/ic05) that `tauri icon` does not emit.
  copyFileSync(source, bundleIcns);
  console.log(`Copied authored icns over ${bundleIcns}`);

  // App Store rejects icons with an alpha channel, and `tauri icon` always
  // writes them with one, so the iOS set has to be flattened again afterwards.
  if (process.platform === "darwin") {
    run("swift", [join(appDir, "scripts", "flatten-ios-app-icons.swift")]);
    console.log("Flattened iOS app icons to opaque PNGs.");
  } else {
    console.warn(
      "Skipped the iOS icon flatten (needs macOS). Run `npm run icons:ios:flatten` there before an App Store build.",
    );
  }
} finally {
  rmSync(workDir, { force: true, recursive: true });
}

console.log(
  "App icons are in sync. Rebuild to pick them up (the tray icon is embedded at compile time).",
);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: appDir, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function largestPngVariant(icns) {
  if (icns.subarray(0, 4).toString("latin1") !== "icns") {
    throw new Error(`${source} is not an .icns file`);
  }

  const variants = new Map();
  let offset = 8;
  while (offset + 8 <= icns.length) {
    const type = icns.subarray(offset, offset + 4).toString("latin1");
    const length = icns.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > icns.length) break;
    variants.set(type, icns.subarray(offset + 8, offset + length));
    offset += length;
  }

  for (const type of PNG_VARIANTS) {
    const data = variants.get(type);
    // ic04/ic05 and the legacy variants hold raw ARGB rather than PNG, and some
    // older icns files store JPEG 2000, so confirm the magic before using one.
    if (data?.subarray(0, 8).equals(PNG_MAGIC)) return { type, png: data };
  }

  throw new Error(`${source} has no PNG variant to generate icons from`);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
}
