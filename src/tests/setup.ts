if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  } as typeof globalThis.ResizeObserver;
}

if (typeof (globalThis as Record<string, unknown>).CSS === "undefined") {
  (globalThis as Record<string, unknown>).CSS = {};
}
if (typeof (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape !== "function") {
  (globalThis as { CSS: { escape: (value: string) => string } }).CSS.escape = (value: string) =>
    value.replace(/([^\w-])/g, "\\$1");
}
if (typeof window !== "undefined" && !window.CSS) {
  (window as unknown as { CSS: unknown }).CSS = (globalThis as Record<string, unknown>).CSS;
}

if (typeof Element !== "undefined" && typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollTo() {};
}

if (!globalThis.localStorage) {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  }
}
