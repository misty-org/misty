#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(
  os.homedir(),
  "Library",
  "Group Containers",
  "group.app.butterkit",
  "MCPAssets",
  "MistyMobileAppStore",
  "en-US",
);
const outputDir = path.resolve(process.env.BUTTERKIT_MCP_ASSETS_DIR || defaultOutput);
const inputDir = path.join(root, "marketing/app-store-screenshots/mobile/raw/accepted");
const sourceManifest = path.join(root, "marketing/app-store-screenshots/mobile/manifest.md");

const screenshots = [
  {
    slot: 1,
    file: "01-files.png",
    screen: "Files",
    copy: "Browse files without losing context",
  },
  {
    slot: 2,
    file: "02-remotes.png",
    screen: "Remotes/provider setup",
    copy: "Connect storage you already use",
  },
  {
    slot: 3,
    file: "03-transfers.png",
    screen: "Transfers",
    copy: "Track uploads, downloads, and sync",
  },
  {
    slot: 4,
    file: "04-settings-account.png",
    screen: "Settings/account",
    copy: "Control account and privacy",
  },
  {
    slot: 5,
    file: "05-account-setup.png",
    screen: "Account setup",
    copy: "Create your Misty login on iPhone",
  },
];

for (const item of screenshots) {
  const source = path.join(inputDir, item.file);
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Missing accepted simulator capture: ${path.relative(root, source)}`);
  }
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

for (const item of screenshots) {
  cpSync(path.join(inputDir, item.file), path.join(outputDir, item.file));
}

if (existsSync(sourceManifest)) {
  cpSync(sourceManifest, path.join(outputDir, "source-screenshot-manifest.md"));
}

const manifest = {
  generatedAt: new Date().toISOString(),
  app: "Misty",
  platform: "iOS",
  locale: "en-US",
  source: path.relative(root, inputDir),
  outputDir,
  butterkitInstructions: [
    "Enable ButterKit Settings -> MCP before using Codex MCP tools.",
    "Use these PNGs as the device screenshots for the five iPhone 6.9-inch App Store artboards.",
    "Export finished ButterKit artboards to marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit.",
  ],
  screenshots: screenshots.map((item) => ({
    ...item,
    path: path.join(outputDir, item.file),
  })),
};

writeFileSync(path.join(outputDir, "butterkit-import-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Staged ${screenshots.length} Misty mobile screenshots for ButterKit:`);
console.log(outputDir);
