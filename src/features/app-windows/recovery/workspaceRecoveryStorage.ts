/** The saved workspace's version. A record saved under an older one is not read: the window
 * starts fresh, and the original is kept beside it. */
export const browserWorkspaceStoreVersion = 19;
export const workspaceRecoveryKey = (name: string) => `${name}:before-browser-workspace:v14`;

/** Keeps the exact text of an older record before Zustand replaces it. */
export function workspaceRecoveryStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const preserve = (name: string, raw: string | null) => {
    if (raw === null || storage.getItem(workspaceRecoveryKey(name)) !== null) return;
    let version = 0;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "version" in parsed &&
        typeof parsed.version === "number"
      )
        version = parsed.version;
    } catch {
      // Keep corrupt records as well: they may contain recoverable user data.
    }
    if (version >= browserWorkspaceStoreVersion) return;
    // If storage is full, fail before replacing the only original copy.
    storage.setItem(workspaceRecoveryKey(name), raw);
  };
  return {
    getItem(name) {
      const raw = storage.getItem(name);
      preserve(name, raw);
      return raw;
    },
    setItem(name, value) {
      preserve(name, storage.getItem(name));
      storage.setItem(name, value);
    },
    removeItem(name) {
      preserve(name, storage.getItem(name));
      storage.removeItem(name);
    },
  };
}
