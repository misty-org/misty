/** Settings › Memory, as the recorder needs them. */
export interface RecallPrivacy {
  enabled: boolean;
  /** Paused until this time (ms since epoch); Infinity pauses until resumed. */
  pausedUntil: number;
  /** Sites never remembered, as host names; subdomains are included. */
  excludedSites: string[];
}

export interface PageCandidate {
  url: string;
  /** Unknown privacy is treated as private. */
  private: boolean | undefined;
  agentOwned?: boolean;
}

export type SkipReason =
  "off" | "paused" | "private" | "agent" | "not-a-web-page" | "excluded" | "sensitive";

/**
 * Sites whose pages are never remembered, whatever the settings say:
 * banking and payments, health, sign-in and account pages, password
 * managers, and email. Matched on the host and its subdomains.
 */
const SENSITIVE_HOSTS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "id.apple.com",
  "auth0.com",
  "okta.com",
  "1password.com",
  "bitwarden.com",
  "lastpass.com",
  "dashlane.com",
  "paypal.com",
  "stripe.com",
  "venmo.com",
  "wise.com",
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "citi.com",
  "capitalone.com",
  "americanexpress.com",
  "schwab.com",
  "fidelity.com",
  "vanguard.com",
  "robinhood.com",
  "coinbase.com",
  "mychart.com",
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "mail.proton.me",
  "mail.yahoo.com",
];
const SENSITIVE_PATHS =
  /\/(log-?in|sign-?in|sign-?up|register|password|reset|checkout|billing|payment|wallet|account\/security|2fa|mfa|otp)(\/|$|\?)/i;
const SENSITIVE_HOST_WORDS =
  /(^|\.)(bank|banking|health|medical|patient|pharmacy|clinic|tax|irs)\./i;

function hostMatches(host: string, site: string) {
  const bare = site
    .trim()
    .toLowerCase()
    .replace(/^\*?\./, "")
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  return Boolean(bare) && (host === bare || host.endsWith(`.${bare}`));
}

/** Why a page is not remembered, or null when it may be. */
export function skipReason(
  page: PageCandidate,
  privacy: RecallPrivacy,
  now = Date.now(),
): SkipReason | null {
  if (!privacy.enabled) return "off";
  if (privacy.pausedUntil > now) return "paused";
  if (page.private !== false) return "private";
  if (page.agentOwned) return "agent";
  let url: URL;
  try {
    url = new URL(page.url);
  } catch {
    return "not-a-web-page";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "not-a-web-page";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith(".local"))
    return "not-a-web-page";
  if (privacy.excludedSites.some((site) => hostMatches(host, site))) return "excluded";
  if (SENSITIVE_HOSTS.some((site) => hostMatches(host, site))) return "sensitive";
  if (SENSITIVE_HOST_WORDS.test(`${host}.`) || SENSITIVE_PATHS.test(url.pathname))
    return "sensitive";
  return null;
}

/** The address as remembered: no fragment, and no query values that look like secrets. */
export function rememberedUrl(raw: string) {
  const url = new URL(raw);
  url.hash = "";
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()])
    if (/token|key|secret|code|auth|session|sig|password|otp|state/i.test(key))
      url.searchParams.delete(key);
  return url.toString();
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[email]"],
  [/\b(?:sk|pk|rk|ghp|gho|xox[abp]|AKIA)[-_A-Za-z0-9]{12,}\b/g, "[key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[token]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[number]"],
];

/** Removes card numbers, email addresses, keys and tokens from page text. */
export function redactSecrets(text: string) {
  return SECRET_PATTERNS.reduce((out, [pattern, label]) => out.replace(pattern, label), text);
}
