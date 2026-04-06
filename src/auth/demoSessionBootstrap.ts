import {
  saveAccountAuthToken,
  type SavedAccountSession,
} from "../pages/Account/shared/authTokenStore";

const demoEmailSuffix = "@demo.misty.local";

type DemoAccount = Omit<SavedAccountSession, "lastUsedAt">;

/**
 * Activates the session created by the local/staging demo harness before the
 * application mounts. This is deliberately unavailable in production builds.
 */
export async function bootstrapDemoSession(): Promise<void> {
  const token = import.meta.env.VITE_MISTY_DEMO_SESSION_TOKEN?.trim();
  const rawAccount = import.meta.env.VITE_MISTY_DEMO_ACCOUNT?.trim();
  if (!token && !rawAccount) return;

  if (!import.meta.env.DEV || import.meta.env.VITE_MISTY_DEMO_MODE !== "1") {
    throw new Error(
      "Demo session bootstrap is only available in an explicit development demo launch.",
    );
  }
  if (!token || token.length < 32 || !rawAccount) {
    throw new Error("Demo session bootstrap requires a session token and account identity.");
  }

  const account = parseDemoAccount(rawAccount);
  await saveAccountAuthToken(token, account);
  window.localStorage.setItem("misty_user", JSON.stringify(account));
}

export function parseDemoAccount(rawAccount: string): DemoAccount {
  let value: unknown;
  try {
    value = JSON.parse(rawAccount);
  } catch {
    throw new Error("Demo account identity must be valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("Demo account identity is missing.");

  const candidate = value as Partial<DemoAccount>;
  const account: DemoAccount = {
    id: String(candidate.id ?? "").trim(),
    name: String(candidate.name ?? "").trim(),
    username: String(candidate.username ?? "").trim() || undefined,
    email: String(candidate.email ?? "")
      .trim()
      .toLowerCase(),
  };
  if (!account.id || !account.name || !account.email.endsWith(demoEmailSuffix)) {
    throw new Error("Demo account identity must contain an id, name, and reserved demo email.");
  }
  return account;
}
