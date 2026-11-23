export const browserWorkspaceStoreVersion = 19;
export const workspaceRecoveryKey = (name: string) => `${name}:before-browser-workspace:v14`;

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
    } catch {}
    if (version >= browserWorkspaceStoreVersion) return;
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
