import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceIcon = path.join(repositoryRoot, "src-tauri/icons/icon.png");
const appIconDirectory = path.join(
  repositoryRoot,
  "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset",
);
const marketingIcon = path.join(appIconDirectory, "AppIcon-512@2x.png");

const iconSizes = new Map([
  ["AppIcon-20x20@1x.png", 20],
  ["AppIcon-20x20@2x-1.png", 40],
  ["AppIcon-20x20@2x.png", 40],
  ["AppIcon-20x20@3x.png", 60],
  ["AppIcon-29x29@1x.png", 29],
  ["AppIcon-29x29@2x-1.png", 58],
  ["AppIcon-29x29@2x.png", 58],
  ["AppIcon-29x29@3x.png", 87],
  ["AppIcon-40x40@1x.png", 40],
  ["AppIcon-40x40@2x-1.png", 80],
  ["AppIcon-40x40@2x.png", 80],
  ["AppIcon-40x40@3x.png", 120],
  ["AppIcon-60x60@2x.png", 120],
  ["AppIcon-60x60@3x.png", 180],
  ["AppIcon-76x76@1x.png", 76],
  ["AppIcon-76x76@2x.png", 152],
  ["AppIcon-83.5x83.5@2x.png", 167],
]);

if (!existsSync(sourceIcon)) {
  throw new Error(`Missing source icon: ${sourceIcon}`);
}

function runMagick(arguments_) {
  const result = spawnSync("magick", arguments_, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ImageMagick exited with status ${result.status}`);
  }
}

// Apple applies the platform corner mask. Flattening the existing monochrome
// mark onto black removes the desktop icon's transparent rounded corners and
// gives iOS an opaque, edge-to-edge source without redrawing the silhouette.
runMagick([
  sourceIcon,
  "-background",
  "black",
  "-alpha",
  "remove",
  "-alpha",
  "off",
  "-filter",
  "Lanczos",
  "-resize",
  "1024x1024!",
  "-strip",
  `PNG24:${marketingIcon}`,
]);

for (const [filename, size] of iconSizes) {
  runMagick([
    marketingIcon,
    "-filter",
    "Lanczos",
    "-resize",
    `${size}x${size}!`,
    "-strip",
    `PNG24:${path.join(appIconDirectory, filename)}`,
  ]);
}

console.log(`Generated ${iconSizes.size + 1} opaque iOS app icons from ${sourceIcon}.`);
