import {
  codingAiClearApiKey,
  codingAiReadApiKey,
  codingAiWriteApiKey,
} from "@/native/settings-plugins";
import { hasTauriInternals } from "@/shared/platform/tauri";

const PREFIX = "misty:coding-ai-key:";

export async function readApiKey(providerId: string): Promise<string | null> {
  // If running in a test or non-Tauri environment, fallback gracefully to localStorage.
  if (!hasTauriInternals()) {
    try {
      return window.localStorage.getItem(`${PREFIX}${providerId}`);
    } catch {
      return null;
    }
  }

  // Check for existing plaintext key in localStorage and migrate it to keyring.
  try {
    const legacyKey = window.localStorage.getItem(`${PREFIX}${providerId}`);
    if (legacyKey) {
      await codingAiWriteApiKey(providerId, legacyKey);
      window.localStorage.removeItem(`${PREFIX}${providerId}`);
      return legacyKey;
    }
  } catch {
    /* localStorage migration best-effort */
  }

  try {
    return await codingAiReadApiKey(providerId);
  } catch {
    return null;
  }
}

export async function writeApiKey(providerId: string, key: string): Promise<void> {
  // Remove any stale plaintext entry.
  try {
    window.localStorage.removeItem(`${PREFIX}${providerId}`);
  } catch {
    /* ignore */
  }

  if (!hasTauriInternals()) {
    try {
      window.localStorage.setItem(`${PREFIX}${providerId}`, key);
    } catch {
      /* ignore */
    }
    return;
  }

  await codingAiWriteApiKey(providerId, key);
}

export async function clearApiKey(providerId: string): Promise<void> {
  try {
    window.localStorage.removeItem(`${PREFIX}${providerId}`);
  } catch {
    /* ignore */
  }

  if (!hasTauriInternals()) {
    return;
  }

  try {
    await codingAiClearApiKey(providerId);
  } catch {
    /* ignore */
  }
}
