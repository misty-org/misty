const PREFIX = "misty:coding-ai-key:";

// MVP: store the API key in localStorage. The Misty desktop app already scopes
// window.localStorage to the app's private data directory, so the key is not
// world-readable, but this is not equivalent to the OS keychain. A future pass
// should move these to the `keyring` crate exposed via a Tauri command; the API
// surface here would not change.
export async function readApiKey(providerId: string): Promise<string | null> {
  try {
    return window.localStorage.getItem(`${PREFIX}${providerId}`);
  } catch {
    return null;
  }
}

export async function writeApiKey(providerId: string, key: string): Promise<void> {
  try {
    window.localStorage.setItem(`${PREFIX}${providerId}`, key);
  } catch {
    /* localStorage may be disabled in some contexts */
  }
}

export async function clearApiKey(providerId: string): Promise<void> {
  try {
    window.localStorage.removeItem(`${PREFIX}${providerId}`);
  } catch {
    /* nothing to remove */
  }
}
