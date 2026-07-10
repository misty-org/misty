#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const outputDir = path.join(root, "build");
const jsonPath = path.join(outputDir, "mobile-submission-status.json");
const markdownPath = path.join(outputDir, "mobile-submission-status.md");

const metadataPath = "marketing/app-store-metadata/en-US/app-store-connect.json";
const metadata = readJson(metadataPath);
const externalQaEvidencePath = process.env.MISTY_IOS_EXTERNAL_QA_EVIDENCE_PATH
  || "build/mobile-external-qa-evidence.json";
const externalQaRequiredChecks = [
  "testFlightInstall",
  "reviewerAccount",
  "providerOAuthReturn",
  "transferAction",
  "signOut",
  "restartPersistence",
  "offlineFailure",
];

const ownerFields = [
  {
    id: "support_url",
    label: "Production support URL",
    env: "MISTY_APP_STORE_SUPPORT_URL",
    path: ["versionInfo", "supportUrl"],
    validate: validateHttpsUrl,
    secret: false,
  },
  {
    id: "privacy_policy_url",
    label: "Production privacy policy URL",
    env: "MISTY_APP_STORE_PRIVACY_POLICY_URL",
    path: ["appInfo", "privacyPolicyUrl"],
    validate: validateHttpsUrl,
    secret: false,
  },
  {
    id: "review_contact_first_name",
    label: "App Review contact first name",
    env: "MISTY_APP_REVIEW_CONTACT_FIRST_NAME",
    path: ["reviewInfo", "contactFirstName"],
    validate: validateText,
    secret: false,
  },
  {
    id: "review_contact_last_name",
    label: "App Review contact last name",
    env: "MISTY_APP_REVIEW_CONTACT_LAST_NAME",
    path: ["reviewInfo", "contactLastName"],
    validate: validateText,
    secret: false,
  },
  {
    id: "review_contact_phone",
    label: "App Review contact phone",
    env: "MISTY_APP_REVIEW_CONTACT_PHONE",
    path: ["reviewInfo", "contactPhone"],
    validate: validatePhone,
    secret: false,
  },
  {
    id: "review_contact_email",
    label: "App Review contact email",
    env: "MISTY_APP_REVIEW_CONTACT_EMAIL",
    path: ["reviewInfo", "contactEmail"],
    validate: validateEmail,
    secret: false,
  },
  {
    id: "demo_account_name",
    label: "Reviewer demo account username/email",
    env: "MISTY_APP_REVIEW_DEMO_ACCOUNT_NAME",
    path: ["reviewInfo", "demoAccountName"],
    validate: validateText,
    secret: true,
  },
  {
    id: "demo_account_password",
    label: "Reviewer demo account password",
    env: "MISTY_APP_REVIEW_DEMO_ACCOUNT_PASSWORD",
    path: ["reviewInfo", "demoAccountPassword"],
    validate: validateText,
    secret: true,
  },
];

const ownerFieldResults = ownerFields.map((field) => {
  const envValue = stringValue(process.env[field.env]);
  const metadataValue = stringValue(get(metadata, field.path));
  const value = envValue || metadataValue;
  const validation = field.validate(value);
  return {
    id: field.id,
    label: field.label,
    env: field.env,
    ok: validation.ok,
    source: envValue ? "environment" : metadataValue ? metadataPath : "missing",
    value: validation.ok && !field.secret ? value : undefined,
    redactedValue: validation.ok && field.secret ? redactSecret(value) : undefined,
    blocker: validation.ok ? null : validation.reason,
  };
});

const checks = [
  fileCheck("mobile_package", "Local App Store handoff package", "build/mobile-app-store-package/manifest.json"),
  fileCheck("fresh_install_manifest", "Fresh-install simulator smoke manifest", "build/mobile-ui-qa/ios-fresh-install-smoke-manifest.json"),
  fileCheck("deeplink_manifest", "Deep-link simulator smoke manifest", "build/mobile-ui-qa/ios-deeplink-smoke-manifest.json"),
  fileCheck("mobile_ui_manifest", "Complete mobile UI simulator smoke manifest", "build/mobile-ui-qa/ios-mobile-ui-smoke-manifest.json"),
  fileCheck("verify_log", "Release verifier log", "build/mobile-app-store-package/validation-logs/verify-mobile-release.txt", /Summary: \d+ passed, \d+ warnings, 0 failures/),
  fileCheck("security_log", "Mobile security audit log", "build/mobile-app-store-package/validation-logs/mobile-security-audit.txt", /PASS No high-confidence secrets/),
  fileCheck("archive_facts", "Archive facts", "build/mobile-app-store-package/ios/archive-facts.json"),
  directoryCheck("fallback_screenshots", "No-watermark local designed fallback screenshots", "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/designed-fallback"),
];

const externalQa = readExternalQaEvidence(externalQaEvidencePath);

const blockers = [];
for (const check of checks) {
  if (!check.ok) {
    blockers.push({
      id: check.id,
      category: "local-evidence",
      label: check.label,
      detail: `${check.label} is ${check.detail ?? "missing"}. Refresh ${check.path} before upload.`,
    });
  }
}
for (const result of ownerFieldResults) {
  if (!result.ok) {
    blockers.push({
      id: result.id,
      category: "owner-field",
      label: result.label,
      detail: `${result.label} is ${result.blocker}. Supply ${result.env} or update ${metadataPath}.`,
    });
  }
}

if (!hasCompleteButterkitSet()) {
  blockers.push({
    id: "butterkit_no_watermark_export",
    category: "ui-approval",
    label: "Final no-watermark ButterKit screenshot export",
    detail: "Approve the mobile UI, then generate the final no-watermark ButterKit App Store screenshot set.",
  });
}

const archiveFacts = existsSync(rel("build/mobile-app-store-package/ios/archive-facts.json"))
  ? readJson("build/mobile-app-store-package/ios/archive-facts.json")
  : null;
if (!archiveFacts?.archiveUploadable) {
  blockers.push({
    id: "signed_archive_upload",
    category: "signing",
    label: "Signed App Store/TestFlight archive",
    detail: archiveFacts?.archiveUploadableReason ?? "Create a signed device archive after Apple signing credentials are available.",
  });
}

if (!archiveFacts?.archiveUploadable && !process.env.MISTY_IOS_DEVELOPMENT_TEAM && !process.env.APPLE_DEVELOPMENT_TEAM) {
  blockers.push({
    id: "apple_team_env",
    category: "signing",
    label: "Apple Developer Team ID",
    detail: "Set MISTY_IOS_DEVELOPMENT_TEAM or APPLE_DEVELOPMENT_TEAM before signed device/archive export.",
  });
}

if (!externalQa.ok) {
  blockers.push({
    id: "testflight_live_provider_smoke",
    category: "external-qa",
    label: "TestFlight/live provider smoke",
    detail: `Run real-device/TestFlight smoke, then create ${externalQaEvidencePath} from marketing/app-store-metadata/en-US/external-qa-evidence.example.json with every required check set to true.`,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  readyForUpload: blockers.length === 0,
  metadata: {
    locale: metadata.locale,
    bundleId: metadata.bundleId,
    versionString: metadata.versionString,
    buildNumber: metadata.buildNumber,
  },
  ownerFields: ownerFieldResults,
  checks,
  externalQa,
  blockers,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, renderMarkdown(report));

console.log("Misty mobile submission status");
console.log(`Ready for upload: ${report.readyForUpload ? "yes" : "no"}`);
console.log(`Blockers: ${blockers.length}`);
console.log(`JSON: ${path.relative(root, jsonPath)}`);
console.log(`Markdown: ${path.relative(root, markdownPath)}`);
for (const blocker of blockers) {
  console.log(`- ${blocker.label}: ${blocker.detail}`);
}

if (strict && blockers.length > 0) {
  process.exit(1);
}

function rel(relativePath) {
  return path.join(root, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(rel(relativePath), "utf8"));
}

function resolveEvidencePath(relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath) ? relativeOrAbsolutePath : rel(relativeOrAbsolutePath);
}

function readExternalQaEvidence(relativeOrAbsolutePath) {
  const absolutePath = resolveEvidencePath(relativeOrAbsolutePath);
  if (!existsSync(absolutePath)) {
    return {
      ok: false,
      path: relativeOrAbsolutePath,
      detail: "missing",
      requiredChecks: externalQaRequiredChecks,
    };
  }
  try {
    const evidence = JSON.parse(readFileSync(absolutePath, "utf8"));
    const missingChecks = externalQaRequiredChecks.filter((key) => evidence[key] !== true);
    const ok = evidence.passed === true && missingChecks.length === 0;
    return {
      ok,
      path: relativeOrAbsolutePath,
      testedAt: stringValue(evidence.testedAt) || null,
      buildNumber: stringValue(evidence.buildNumber) || null,
      device: stringValue(evidence.device) || null,
      missingChecks,
      requiredChecks: externalQaRequiredChecks,
      detail: ok ? "all required external checks passed" : `missing passing evidence for: ${missingChecks.join(", ") || "passed"}`,
    };
  } catch {
    return {
      ok: false,
      path: relativeOrAbsolutePath,
      detail: "invalid JSON",
      requiredChecks: externalQaRequiredChecks,
    };
  }
}

function hasCompleteButterkitSet() {
  const directory = "marketing/app-store-screenshots/mobile/final/iphone-6-9/en-US/butterkit";
  return ["01-files.png", "02-remotes.png", "03-transfers.png", "04-settings-account.png", "05-account-setup.png"]
    .every((file) => existsSync(rel(`${directory}/${file}`)));
}

function get(object, keys) {
  return keys.reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), object);
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateHttpsUrl(value) {
  if (!value) return { ok: false, reason: "missing" };
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return { ok: false, reason: "not an HTTPS URL" };
    if (isPlaceholderUrl(url)) return { ok: false, reason: "not a production URL" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
}

function isPlaceholderUrl(url) {
  const hostname = url.hostname.toLowerCase();
  const fullUrl = url.toString().toLowerCase();
  return (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname.endsWith(".local")
    || hostname === "example"
    || hostname.endsWith(".example")
    || hostname === "example.com"
    || hostname.endsWith(".example.com")
    || hostname === "example.org"
    || hostname.endsWith(".example.org")
    || hostname === "example.net"
    || hostname.endsWith(".example.net")
    || fullUrl.includes("placeholder")
    || fullUrl.includes("your-domain")
    || fullUrl.includes("todo")
  );
}

function validateText(value) {
  return value ? { ok: true } : { ok: false, reason: "missing" };
}

function validateEmail(value) {
  if (!value) return { ok: false, reason: "missing" };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? { ok: true }
    : { ok: false, reason: "not a valid email address" };
}

function validatePhone(value) {
  if (!value) return { ok: false, reason: "missing" };
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? { ok: true } : { ok: false, reason: "not a reachable phone number" };
}

function redactSecret(value) {
  if (!value) return undefined;
  if (value.length <= 4) return "set";
  return `${value.slice(0, 2)}...${value.slice(-2)} (${value.length} chars)`;
}

function fileCheck(id, label, relativePath, pattern = null) {
  const absolutePath = rel(relativePath);
  if (!existsSync(absolutePath)) {
    return { id, label, ok: false, path: relativePath, detail: "missing" };
  }
  if (pattern) {
    const text = readFileSync(absolutePath, "utf8");
    if (!pattern.test(text)) {
      return { id, label, ok: false, path: relativePath, detail: "content did not match expected status" };
    }
  }
  return { id, label, ok: true, path: relativePath };
}

function directoryCheck(id, label, relativePath) {
  return existsSync(rel(relativePath))
    ? { id, label, ok: true, path: relativePath }
    : { id, label, ok: false, path: relativePath, detail: "missing" };
}

function renderMarkdown(report) {
  const lines = [
    "# Misty Mobile Submission Status",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Ready for upload: ${report.readyForUpload ? "yes" : "no"}`,
    "",
    "## Local Evidence",
    "",
    "| Check | Status | Path |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.label} | ${check.ok ? "Pass" : "Missing"} | \`${check.path}\` |`),
    "",
    "## Owner Fields",
    "",
    "| Field | Status | Source |",
    "| --- | --- | --- |",
    ...report.ownerFields.map((field) => `| ${field.label} | ${field.ok ? "Pass" : "Missing"} | ${field.source} |`),
    "",
    "## External QA",
    "",
    `Status: ${report.externalQa.ok ? "Pass" : "Missing"}`,
    "",
    `Evidence: \`${report.externalQa.path}\``,
    "",
    "## Remaining Blockers",
    "",
    ...report.blockers.map((blocker) => `- ${blocker.label}: ${blocker.detail}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
