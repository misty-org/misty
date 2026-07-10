#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  try {
    execFileSync("npm", ["run", "build:mobile"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
  } catch (error) {
    console.error("Could not build fresh mobile dist before mobile security audit.");
    if (error instanceof Error) console.error(error.message);
    process.exit(1);
  }
}

const rootsToScan = [
  ".env.mobile",
  "dist",
  "src",
  "src-tauri/src",
  "src-tauri/Info.ios.plist",
  "src-tauri/tauri.ios.conf.json",
  "marketing/app-store-metadata/en-US",
];

const ignoredPathParts = new Set([
  ".git",
  "node_modules",
  "target",
  "build",
  "src-tauri/target",
]);

const textExtensions = new Set([
  "",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".plist",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
]);

const secretPatterns = [
  { label: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: "GitHub personal access token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g },
  { label: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{60,255}\b/g },
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { label: "Stripe live secret key", pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g },
  { label: "SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g },
  { label: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g },
];

const forbiddenDistStrings = [
  "Misty server API",
  "Server env",
  "Clear debug events",
  "misty.clientDebug.events.v1",
  "Action debug",
  "Provider auth debug",
  "Browse extensions",
  "Manage extensions",
  "Search extensions",
  "Installed extensions",
  "desktop_notifications_enabled",
  "Open With...",
  "Choose Application",
  "Upload Folder",
  "Mika AI is coming soon",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

const files = [];
for (const relativeRoot of rootsToScan) {
  collectFiles(path.join(root, relativeRoot), relativeRoot);
}

const findings = [];
for (const file of files) {
  const text = readFileSync(file.absolute, "utf8");
  for (const { label, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({
        severity: "high",
        label,
        file: file.relative,
        line: lineNumber(text, match.index ?? 0),
        value: redact(match[0]),
      });
    }
  }

  if (file.relative.startsWith("dist/")) {
    for (const term of forbiddenDistStrings) {
      const index = text.indexOf(term);
      if (index >= 0) {
        findings.push({
          severity: "high",
          label: `production mobile bundle contains ${term}`,
          file: file.relative,
          line: lineNumber(text, index),
          value: term,
        });
      }
    }
  }
}

console.log("Misty mobile security audit\n");
console.log(`Scanned ${files.length} text files across mobile source, iOS native source, metadata, .env.mobile, and dist.`);
console.log("Checks:");
console.log("- High-confidence secret formats only, to avoid false positives from ordinary variable names.");
console.log("- Production mobile bundle strings for debug panels, extension UI, and assistant placeholders.");

if (findings.length > 0) {
  console.log("");
  for (const finding of findings) {
    console.log(`FAIL [${finding.severity}] ${finding.label}`);
    console.log(`  ${finding.file}:${finding.line}`);
    console.log(`  ${finding.value}`);
  }
  console.log(`\nSummary: ${findings.length} security finding${findings.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("\nPASS No high-confidence secrets or forbidden production mobile bundle strings found.");

function collectFiles(absolutePath, relativePath) {
  if (!existsSync(absolutePath)) return;
  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(absolutePath)) {
      const childRelative = path.join(relativePath, entry);
      if (shouldIgnore(childRelative)) continue;
      collectFiles(path.join(absolutePath, entry), childRelative);
    }
    return;
  }
  if (!stats.isFile()) return;
  if (stats.size > 5 * 1024 * 1024) return;
  if (!textExtensions.has(path.extname(absolutePath))) return;
  files.push({ absolute: absolutePath, relative: relativePath });
}

function shouldIgnore(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return [...ignoredPathParts].some((part) => normalized === part || normalized.startsWith(`${part}/`) || normalized.includes(`/${part}/`));
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function redact(value) {
  if (value.length <= 12) return "[redacted]";
  return `${value.slice(0, 6)}...[redacted]...${value.slice(-4)}`;
}
