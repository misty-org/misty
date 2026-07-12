#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, "build/mobile-app-store-package");
const logsDir = path.join(outputRoot, "validation-logs");

function rel(...parts) {
  return path.join(root, ...parts);
}

function out(...parts) {
  return path.join(outputRoot, ...parts);
}

function copyFileOrDir(sourceRelative, destinationRelative) {
  const source = rel(sourceRelative);
  const destination = out(destinationRelative);
  if (!existsSync(source)) {
    throw new Error(`Missing package source: ${sourceRelative}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: statSync(source).isDirectory() });
}

function runForLog(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const text = [
    `$ ${[command, ...args].join(" ")}`,
    "",
    result.stdout ?? "",
    result.stderr ? `\n[stderr]\n${result.stderr}` : "",
    `\nexitCode=${result.status ?? "error"}`,
  ].join("\n");
  writeFileSync(path.join(logsDir, `${name}.txt`), text);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed; see validation-logs/${name}.txt`);
  }
  return text;
}

function runDiagnosticLog(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const text = [
    `$ ${[command, ...args].join(" ")}`,
    "",
    result.stdout ?? "",
    result.stderr ? `\n[stderr]\n${result.stderr}` : "",
    `\nexitCode=${result.status ?? "error"}`,
    "",
    "Diagnostic-only log. A non-zero exit code here records the current external signing/preflight blocker and does not make the local App Store handoff package invalid.",
  ].join("\n");
  writeFileSync(path.join(logsDir, `${name}.txt`), text);
  if (result.error) throw result.error;
  return text;
}

function plistValue(plistRelative, key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", rel(plistRelative)], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function codeSignFacts(appRelative) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", rel(appRelative)], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const authorities = [...output.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim());
  const signature = output.match(/^Signature=(.+)$/m)?.[1]?.trim() ?? "";
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? "";
  return {
    inspected: result.status === 0,
    signature: signature || null,
    teamIdentifier: teamIdentifier && teamIdentifier !== "not set" ? teamIdentifier : null,
    distributionSigned: authorities.some((authority) => /^(Apple|iPhone) Distribution(?::|$)/.test(authority)),
    adHoc: /adhoc/i.test(signature) || /\badhoc\b/i.test(output),
  };
}

function archiveUploadability(appExists, platformName, signing) {
  if (!appExists) return { uploadable: false, reason: "The archive app bundle is missing." };
  if (platformName !== "iphoneos") {
    return {
      uploadable: false,
      reason: "The locally validated archive targets the iOS simulator. App Store/TestFlight upload requires a signed iphoneos archive from npm run tauri:ios:archive:app-store.",
    };
  }
  if (signing.adHoc || !signing.teamIdentifier || !signing.distributionSigned) {
    return {
      uploadable: false,
      reason: "The iphoneos archive is not signed with an Apple Distribution identity and team. Repair signing, then rerun npm run tauri:ios:archive:app-store.",
    };
  }
  return { uploadable: true, reason: null };
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(logsDir, { recursive: true });

runForLog("build-mobile", "npm", ["run", "build:mobile"]);
runForLog("cargo-check-tauri", "cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
runForLog("cargo-check-tauri-ios-simulator", "cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--target", "aarch64-apple-ios-sim"]);
runForLog("cargo-check-tauri-embedded-storage", "cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", "--features", "embedded-storage-go"]);
runForLog("verify-mobile-release", "npm", ["run", "verify:mobile-release", "--", "--skip-build"]);
runForLog("mobile-security-audit", "npm", ["run", "security:mobile:audit", "--", "--skip-build"]);
runForLog("app-store-owner-fields", "npm", ["run", "app-store:owner-fields:check"]);
runDiagnosticLog("tauri-ios-device-preflight", "npm", ["run", "tauri:ios:device:preflight"]);
runDiagnosticLog("tauri-ios-archive-preflight", "npm", ["run", "tauri:ios:archive:preflight"]);
runForLog("tauri-ios-archive-validate", "npm", ["run", "tauri:ios:archive:validate"]);

copyFileOrDir("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/designed-fallback", "screenshots/final/iphone-6-9/en-US/designed-fallback");
copyFileOrDir("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/fallback-direct-resize", "screenshots/final/iphone-6-9/en-US/fallback-direct-resize");
copyFileOrDir("marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/README.md", "screenshots/final/iphone-6-9/en-US/README.md");
copyFileOrDir("marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/designed-fallback", "screenshots/final/iphone-6-5/en-US/designed-fallback");
copyFileOrDir("marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/fallback-direct-resize", "screenshots/final/iphone-6-5/en-US/fallback-direct-resize");
copyFileOrDir("marketing/app-store-screenshots/mobile/final/iphone-6-5/en-US/README.md", "screenshots/final/iphone-6-5/en-US/README.md");
copyFileOrDir("marketing/app-store-screenshots/mobile/raw/accepted", "screenshots/raw/accepted");
copyFileOrDir("marketing/app-store-screenshots/mobile/manifest.md", "screenshots/manifest.md");

copyFileOrDir("marketing/app-store-metadata/en-US", "metadata/en-US");
copyFileOrDir("docs/mobile-app-store-readiness.md", "docs/mobile-app-store-readiness.md");
copyFileOrDir("docs/mobile-app-store-completion-audit.md", "docs/mobile-app-store-completion-audit.md");
copyFileOrDir("docs/mobile-qa-log.md", "docs/mobile-qa-log.md");

copyFileOrDir("scripts/run-ios-simulator.mjs", "release-scripts/run-ios-simulator.mjs");
copyFileOrDir("scripts/run-ios-device.mjs", "release-scripts/run-ios-device.mjs");
copyFileOrDir("scripts/build-ios-release.mjs", "release-scripts/build-ios-release.mjs");
copyFileOrDir("scripts/notarize-macos.mjs", "release-scripts/notarize-macos.mjs");
copyFileOrDir("scripts/design-mobile-app-store-screenshots.swift", "release-scripts/design-mobile-app-store-screenshots.swift");
copyFileOrDir("scripts/generate-app-store-screenshots.swift", "release-scripts/generate-app-store-screenshots.swift");
copyFileOrDir("scripts/stage-butterkit-mobile-screenshots.mjs", "release-scripts/stage-butterkit-mobile-screenshots.mjs");
copyFileOrDir("scripts/smoke-ios-simulator-fresh-install.mjs", "release-scripts/smoke-ios-simulator-fresh-install.mjs");
copyFileOrDir("scripts/smoke-ios-simulator-deeplinks.mjs", "release-scripts/smoke-ios-simulator-deeplinks.mjs");
copyFileOrDir("scripts/smoke-ios-simulator-ui.mjs", "release-scripts/smoke-ios-simulator-ui.mjs");
copyFileOrDir("scripts/flatten-ios-app-icons.swift", "release-scripts/flatten-ios-app-icons.swift");
copyFileOrDir("scripts/audit-mobile-security.mjs", "release-scripts/audit-mobile-security.mjs");
copyFileOrDir("scripts/report-mobile-submission-status.mjs", "release-scripts/report-mobile-submission-status.mjs");
copyFileOrDir("scripts/verify-mobile-release-readiness.mjs", "release-scripts/verify-mobile-release-readiness.mjs");
copyFileOrDir("scripts/package-mobile-app-store.mjs", "release-scripts/package-mobile-app-store.mjs");
copyFileOrDir("scripts/validate-app-store-owner-fields.mjs", "release-scripts/validate-app-store-owner-fields.mjs");

copyFileOrDir("src-tauri/tauri.ios.conf.json", "ios/config/tauri.ios.conf.json");
copyFileOrDir("src-tauri/Info.ios.plist", "ios/config/Info.ios.plist");
copyFileOrDir("src-tauri/gen/apple/project.yml", "ios/config/project.yml");
copyFileOrDir("src-tauri/gen/apple/misty-desktop_iOS/Info.plist", "ios/generated/Info.plist");
copyFileOrDir("src-tauri/gen/apple/misty-desktop_iOS/PrivacyInfo.xcprivacy", "ios/generated/PrivacyInfo.xcprivacy");
copyFileOrDir("src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset", "ios/generated/AppIcon.appiconset");

const archiveInfo = "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app/Info.plist";
const archivePrivacy = "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app/PrivacyInfo.xcprivacy";
const archiveAppRelative = "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app";
const archiveApp = rel("src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app");
const archiveSigning = existsSync(archiveApp) ? codeSignFacts(archiveAppRelative) : {
  inspected: false,
  signature: null,
  teamIdentifier: null,
  distributionSigned: false,
  adHoc: false,
};
const archivePlatformName = plistValue(archiveInfo, "DTPlatformName");
const uploadability = archiveUploadability(existsSync(archiveApp), archivePlatformName, archiveSigning);
const archiveFacts = {
  generatedAt: new Date().toISOString(),
  archivePath: "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive",
  archiveAppPath: "src-tauri/gen/apple/build/misty-desktop_iOS.xcarchive/Products/Applications/Misty.app",
  archiveAppExists: existsSync(archiveApp),
  bundleIdentifier: plistValue(archiveInfo, "CFBundleIdentifier"),
  shortVersion: plistValue(archiveInfo, "CFBundleShortVersionString"),
  buildNumber: plistValue(archiveInfo, "CFBundleVersion"),
  minimumOSVersion: plistValue(archiveInfo, "MinimumOSVersion"),
  platformName: archivePlatformName,
  targetDeviceFamily: {
    iphone: plistValue(archiveInfo, "UIDeviceFamily.0"),
    ipad: plistValue(archiveInfo, "UIDeviceFamily.1") || null,
  },
  supportedInterfaceOrientations: {
    iphone: [
      plistValue(archiveInfo, "UISupportedInterfaceOrientations.0"),
      plistValue(archiveInfo, "UISupportedInterfaceOrientations.1"),
      plistValue(archiveInfo, "UISupportedInterfaceOrientations.2"),
    ].filter(Boolean),
  },
  exportComplianceUsesNonExemptEncryption: plistValue(archiveInfo, "ITSAppUsesNonExemptEncryption"),
  urlScheme: plistValue(archiveInfo, "CFBundleURLTypes.0.CFBundleURLSchemes.0"),
  privacyManifestBundled: existsSync(rel(archivePrivacy)),
  signing: archiveSigning,
  archiveUploadable: uploadability.uploadable,
  archiveUploadableReason: uploadability.reason,
};
writeFileSync(out("ios/archive-facts.json"), `${JSON.stringify(archiveFacts, null, 2)}\n`);

const appStoreConnect = JSON.parse(readFileSync(rel("marketing/app-store-metadata/en-US/app-store-connect.json"), "utf8"));
const screenshotFiles = [
  "01-files.png",
  "02-remotes.png",
  "03-transfers.png",
  "04-settings-account.png",
  "05-account-setup.png",
];
const uiQaCaptures = [
  "44-smoke-fresh-install-first-launch.png",
  "45-smoke-fresh-install-providers.png",
  "46-smoke-fresh-install-account-signin.png",
  "50-smoke-ui-files.png",
  "51-smoke-ui-remotes.png",
  "52-smoke-ui-transfers.png",
  "53-smoke-ui-account.png",
  "54-smoke-ui-account-signin.png",
  "55-smoke-ui-account-register.png",
  "56-smoke-ui-settings.png",
  "40-smoke-cold-providers.png",
  "41-smoke-foreground-files.png",
  "42-smoke-foreground-providers.png",
  "43-smoke-foreground-account-signin.png",
];
for (const file of uiQaCaptures) {
  copyFileOrDir(`build/mobile-ui-qa/${file}`, `qa/mobile-ui-qa/${file}`);
}
copyFileOrDir("build/mobile-ui-qa/ios-fresh-install-smoke-manifest.json", "qa/mobile-ui-qa/ios-fresh-install-smoke-manifest.json");
copyFileOrDir("build/mobile-ui-qa/ios-deeplink-smoke-manifest.json", "qa/mobile-ui-qa/ios-deeplink-smoke-manifest.json");
copyFileOrDir("build/mobile-ui-qa/ios-mobile-ui-smoke-manifest.json", "qa/mobile-ui-qa/ios-mobile-ui-smoke-manifest.json");
const externalQaEvidenceSource = process.env.MISTY_IOS_EXTERNAL_QA_EVIDENCE_PATH
  || rel("build/mobile-external-qa-evidence.json");
const externalQaEvidencePath = path.isAbsolute(externalQaEvidenceSource)
  ? externalQaEvidenceSource
  : rel(externalQaEvidenceSource);
const externalQaEvidencePackaged = existsSync(externalQaEvidencePath);
if (externalQaEvidencePackaged) {
  const destination = out("qa/mobile-external-qa-evidence.json");
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(externalQaEvidencePath, destination);
}
const manifest = {
  generatedAt: archiveFacts.generatedAt,
  packageRoot: "build/mobile-app-store-package",
  bundleId: appStoreConnect.bundleId,
  versionString: appStoreConnect.versionString,
  buildNumber: appStoreConnect.buildNumber,
  screenshots: {
    finalDesignedFallback: screenshotFiles.map((file) => `screenshots/final/iphone-6-9/en-US/designed-fallback/${file}`),
    finalDirectResizeFallback: screenshotFiles.map((file) => `screenshots/final/iphone-6-9/en-US/fallback-direct-resize/${file}`),
    optionalIphone65DesignedFallback: screenshotFiles.map((file) => `screenshots/final/iphone-6-5/en-US/designed-fallback/${file}`),
    optionalIphone65DirectResizeFallback: screenshotFiles.map((file) => `screenshots/final/iphone-6-5/en-US/fallback-direct-resize/${file}`),
    rawAccepted: screenshotFiles.map((file) => `screenshots/raw/accepted/${file}`),
    guidance: "screenshots/final/iphone-6-9/en-US/README.md",
    optionalIphone65Guidance: "screenshots/final/iphone-6-5/en-US/README.md",
  },
  metadata: [
    "metadata/en-US/app-store-connect.json",
    "metadata/en-US/app-info.md",
    "metadata/en-US/review-notes.txt",
    "metadata/en-US/review-notes.md",
    "metadata/en-US/privacy-labels-draft.md",
    "metadata/en-US/publish-checklist.md",
    "metadata/en-US/app-store-owner-fields.env.example",
    "metadata/en-US/external-qa-evidence.example.json",
  ],
  docs: [
    "docs/mobile-app-store-readiness.md",
    "docs/mobile-app-store-completion-audit.md",
    "docs/mobile-qa-log.md",
  ],
  submissionStatus: [
    "submission-status.json",
    "submission-status.md",
  ],
  qaEvidence: uiQaCaptures.map((file) => `qa/mobile-ui-qa/${file}`),
  qaManifests: [
    "qa/mobile-ui-qa/ios-fresh-install-smoke-manifest.json",
    "qa/mobile-ui-qa/ios-deeplink-smoke-manifest.json",
    "qa/mobile-ui-qa/ios-mobile-ui-smoke-manifest.json",
  ],
  externalQaEvidence: externalQaEvidencePackaged
    ? ["qa/mobile-external-qa-evidence.json"]
    : [],
  validationLogs: [
    "validation-logs/build-mobile.txt",
    "validation-logs/cargo-check-tauri.txt",
    "validation-logs/cargo-check-tauri-ios-simulator.txt",
    "validation-logs/cargo-check-tauri-embedded-storage.txt",
    "validation-logs/verify-mobile-release.txt",
    "validation-logs/mobile-security-audit.txt",
    "validation-logs/app-store-owner-fields.txt",
    "validation-logs/app-store-submission-status.txt",
    "validation-logs/tauri-ios-device-preflight.txt",
    "validation-logs/tauri-ios-archive-preflight.txt",
    "validation-logs/tauri-ios-archive-validate.txt",
  ],
  releaseScripts: [
    "release-scripts/run-ios-simulator.mjs",
    "release-scripts/run-ios-device.mjs",
    "release-scripts/build-ios-release.mjs",
    "release-scripts/notarize-macos.mjs",
    "release-scripts/design-mobile-app-store-screenshots.swift",
    "release-scripts/generate-app-store-screenshots.swift",
    "release-scripts/stage-butterkit-mobile-screenshots.mjs",
    "release-scripts/smoke-ios-simulator-fresh-install.mjs",
    "release-scripts/smoke-ios-simulator-deeplinks.mjs",
    "release-scripts/smoke-ios-simulator-ui.mjs",
    "release-scripts/flatten-ios-app-icons.swift",
    "release-scripts/audit-mobile-security.mjs",
    "release-scripts/report-mobile-submission-status.mjs",
    "release-scripts/verify-mobile-release-readiness.mjs",
    "release-scripts/package-mobile-app-store.mjs",
    "release-scripts/validate-app-store-owner-fields.mjs",
  ],
  butterkitStaging: {
    command: "npm run screenshots:mobile:stage-butterkit",
    defaultOutput: "~/Library/Group Containers/group.app.butterkit/MCPAssets/MistyMobileAppStore/en-US",
    overrideEnv: "BUTTERKIT_MCP_ASSETS_DIR",
    exportDestination: "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit",
    watermarkedDraft: "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit-watermarked-draft",
  },
  remainingExternalBlockers: [
    "Approve the mobile UI, then regenerate final no-watermark App Store screenshots from the approved simulator states.",
    "Supply production support URL and privacy policy URL.",
    "Supply App Review contact fields and reviewer demo credentials.",
    "Repair Apple signing/App Store Connect credentials and create a signed device archive.",
    "Run real-device/TestFlight, live provider OAuth/deep-link, and reviewer-account smoke tests.",
  ],
};
writeFileSync(out("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const readme = `# Misty Mobile App Store Package

Generated: ${archiveFacts.generatedAt}

This folder gathers the current local iOS submission assets and validation evidence for Misty mobile.

## Use For App Store Connect

- Screenshots: \`screenshots/final/iphone-6-9/en-US/designed-fallback\`
- Optional 6.5-inch screenshots: \`screenshots/final/iphone-6-5/en-US/designed-fallback\`
- Metadata: \`metadata/en-US/app-store-connect.json\`
- Paste-ready review notes: \`metadata/en-US/review-notes.txt\`
- Privacy-label draft: \`metadata/en-US/privacy-labels-draft.md\`
- Publish checklist: \`metadata/en-US/publish-checklist.md\`
- Owner-field env template: \`metadata/en-US/app-store-owner-fields.env.example\`
- External QA evidence template: \`metadata/en-US/external-qa-evidence.example.json\`
- QA log: \`docs/mobile-qa-log.md\`
- Submission status: \`submission-status.md\` and \`submission-status.json\`
- Current UI QA captures: \`qa/mobile-ui-qa\`
- Release scripts: \`release-scripts\`

Refresh simulator deep-link QA after installing the simulator app with:

\`\`\`sh
TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:deeplinks
\`\`\`

The command writes route captures and \`ios-deeplink-smoke-manifest.json\` under \`build/mobile-ui-qa\`; the packaged copies are under \`qa/mobile-ui-qa\`.

Refresh the complete mobile screen audit with:

\`\`\`sh
TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:ui
\`\`\`

This captures Files, Remotes, Transfers, Account, sign-in, registration, and Settings with an opaque simulator mask and writes \`ios-mobile-ui-smoke-manifest.json\`.

Refresh destructive fresh-install simulator QA from the current built app with:

\`\`\`sh
TAURI_IOS_SIMULATOR_DEVICE="iPhone 17" npm run smoke:ios:simulator:fresh-install
\`\`\`

This uninstalls Misty from the selected simulator before reinstalling the current archive, then writes the first-launch welcome, Account sign-in, Remotes, and \`ios-fresh-install-smoke-manifest.json\` under \`build/mobile-ui-qa\`.

## Validation

- \`validation-logs/build-mobile.txt\`
- \`validation-logs/cargo-check-tauri.txt\`
- \`validation-logs/cargo-check-tauri-ios-simulator.txt\`
- \`validation-logs/cargo-check-tauri-embedded-storage.txt\`
- \`validation-logs/verify-mobile-release.txt\`
- \`validation-logs/mobile-security-audit.txt\`
- \`validation-logs/app-store-owner-fields.txt\`
- \`validation-logs/app-store-submission-status.txt\`
- \`validation-logs/tauri-ios-device-preflight.txt\`
- \`validation-logs/tauri-ios-archive-preflight.txt\`
- \`validation-logs/tauri-ios-archive-validate.txt\`

Run \`npm run app-store:owner-fields:strict\` after adding the production support URL, privacy policy URL, App Review contact, and reviewer demo credentials. The check accepts local environment variables so reviewer credentials do not need to be committed, and rejects sample, placeholder, or local support/privacy URLs.

After real-device/TestFlight QA passes, create \`build/mobile-external-qa-evidence.json\` from the packaged external-QA template and set every required check plus \`passed\` to true. Override its location with \`MISTY_IOS_EXTERNAL_QA_EVIDENCE_PATH\`.

## ButterKit Staging

Stage accepted simulator captures into ButterKit's MCP import folder with:

\`\`\`sh
npm run screenshots:mobile:stage-butterkit
\`\`\`

By default this writes to \`~/Library/Group Containers/group.app.butterkit/MCPAssets/MistyMobileAppStore/en-US\`. Override with \`BUTTERKIT_MCP_ASSETS_DIR=/path/to/folder\` if ButterKit is configured with a different Agent Import Folder.

The current direct ButterKit export adds a \`Made with ButterKit\` watermark and was generated before final UI approval, so it is kept only as a draft and must not be uploaded to App Store Connect. Do not resume App Store screenshot production until the mobile UI is approved.

## Archive State

The local archive facts are in \`ios/archive-facts.json\`.

The iOS device and signed archive preflight logs are in \`validation-logs/tauri-ios-device-preflight.txt\` and \`validation-logs/tauri-ios-archive-preflight.txt\`. A non-zero exit code there records the current signing/account blocker without invalidating the local handoff package.

The current archive is validated for simulator/package correctness and is configured as iPhone-only. It is not an App Store upload artifact. Create the signed device archive with:

\`\`\`sh
MISTY_IOS_DEVELOPMENT_TEAM=<team-id> MISTY_IOS_BUILD_NUMBER=<build> npm run tauri:ios:archive:app-store
\`\`\`

## Still Required

- Approve the mobile UI, then regenerate final App Store screenshots. Use only no-watermark assets.
- Add production support/privacy URLs.
- Add App Review contact and demo credentials.
- Upload a signed device archive.
- Run TestFlight real-device smoke with live provider OAuth/deep-link coverage.
`;
writeFileSync(out("README.md"), readme);

runForLog("app-store-submission-status", "npm", ["run", "app-store:submission-status"]);
copyFileOrDir("build/mobile-submission-status.json", "submission-status.json");
copyFileOrDir("build/mobile-submission-status.md", "submission-status.md");

for (const file of [
  ...manifest.screenshots.finalDesignedFallback,
  ...manifest.screenshots.finalDirectResizeFallback,
  ...manifest.screenshots.optionalIphone65DesignedFallback,
  ...manifest.screenshots.optionalIphone65DirectResizeFallback,
  ...manifest.screenshots.rawAccepted,
  manifest.screenshots.guidance,
  manifest.screenshots.optionalIphone65Guidance,
  ...manifest.metadata,
  ...manifest.submissionStatus,
  ...manifest.qaManifests,
  ...manifest.validationLogs,
  ...manifest.releaseScripts,
  ...manifest.qaEvidence,
  "README.md",
  "ios/archive-facts.json",
]) {
  if (!existsSync(out(file))) {
    throw new Error(`Package manifest references a missing file: ${file}`);
  }
}

console.log(`Created ${outputRoot}`);
