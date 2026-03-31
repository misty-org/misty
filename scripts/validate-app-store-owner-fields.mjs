#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const strict = process.argv.includes("--strict");
const metadataPath = path.join(root, "marketing/app-store-metadata/en-US/app-store-connect.json");
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));

const fields = [
  {
    label: "Support URL",
    path: ["versionInfo", "supportUrl"],
    env: "MISTY_APP_STORE_SUPPORT_URL",
    validate: validateHttpsUrl,
    publicValue: true,
  },
  {
    label: "Privacy Policy URL",
    path: ["appInfo", "privacyPolicyUrl"],
    env: "MISTY_APP_STORE_PRIVACY_POLICY_URL",
    validate: validateHttpsUrl,
    publicValue: true,
  },
  {
    label: "Review contact first name",
    path: ["reviewInfo", "contactFirstName"],
    env: "MISTY_APP_REVIEW_CONTACT_FIRST_NAME",
    validate: validateText,
    publicValue: true,
  },
  {
    label: "Review contact last name",
    path: ["reviewInfo", "contactLastName"],
    env: "MISTY_APP_REVIEW_CONTACT_LAST_NAME",
    validate: validateText,
    publicValue: true,
  },
  {
    label: "Review contact phone",
    path: ["reviewInfo", "contactPhone"],
    env: "MISTY_APP_REVIEW_CONTACT_PHONE",
    validate: validatePhone,
    publicValue: true,
  },
  {
    label: "Review contact email",
    path: ["reviewInfo", "contactEmail"],
    env: "MISTY_APP_REVIEW_CONTACT_EMAIL",
    validate: validateEmail,
    publicValue: true,
  },
  {
    label: "Reviewer demo account username/email",
    path: ["reviewInfo", "demoAccountName"],
    env: "MISTY_APP_REVIEW_DEMO_ACCOUNT_NAME",
    validate: validateText,
    publicValue: false,
  },
  {
    label: "Reviewer demo account password",
    path: ["reviewInfo", "demoAccountPassword"],
    env: "MISTY_APP_REVIEW_DEMO_ACCOUNT_PASSWORD",
    validate: validateText,
    publicValue: false,
  },
];

const results = fields.map((field) => {
  const envValue = stringValue(process.env[field.env]);
  const metadataValue = stringValue(get(metadata, field.path));
  const value = envValue || metadataValue;
  const source = envValue ? field.env : metadataValue ? "app-store-connect.json" : "missing";
  const validation = field.validate(value);
  return {
    ...field,
    value,
    source,
    ok: validation.ok,
    reason: validation.reason,
  };
});

const missingOrInvalid = results.filter((result) => !result.ok);

console.log("Misty App Store owner-field readiness\n");
for (const result of results) {
  const status = result.ok ? "PASS" : "WARN";
  const value = result.ok
    ? result.publicValue
      ? result.value
      : redactSecret(result.value)
    : result.reason;
  console.log(`${status} ${result.label}: ${value} (${result.source})`);
}

console.log("\nEnvironment variables accepted for final local validation:");
for (const field of fields) {
  console.log(`- ${field.env}`);
}

if (missingOrInvalid.length > 0) {
  console.log(`\n${missingOrInvalid.length} owner-supplied fields still need attention before App Store submission.`);
  if (strict) {
    process.exit(1);
  }
} else {
  console.log("\nAll owner-supplied App Store fields are present and locally valid.");
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
    if (url.protocol !== "https:") {
      return { ok: false, reason: "must be an https URL" };
    }
    if (isPlaceholderUrl(url)) {
      return { ok: false, reason: "must be a production URL, not a placeholder or local URL" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "must be a valid URL" };
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
    : { ok: false, reason: "must be a valid email address" };
}

function validatePhone(value) {
  if (!value) return { ok: false, reason: "missing" };
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? { ok: true } : { ok: false, reason: "must include a reachable phone number" };
}

function redactSecret(value) {
  if (!value) return "missing";
  if (value.length <= 4) return "set";
  return `${value.slice(0, 2)}...${value.slice(-2)} (${value.length} chars)`;
}
