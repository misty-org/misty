// SPDX-License-Identifier: MIT
// Extension API functions work when taken off their object in Chrome and Firefox
// (`vAPI.getURL = browser.runtime.getURL`, `const t = chrome.i18n.getMessage`);
// WebKit's return nothing once detached. Runs last, so every API function, the
// compatibility layer's included, is bound to its namespace.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const bound = new WeakSet();
  /** Every property name up the prototype chain, as WebKit defines APIs there. */
  const names = (target) => {
    const out = new Set();
    for (let object = target; object && object !== Object.prototype; object = Object.getPrototypeOf(object))
      for (const name of Object.getOwnPropertyNames(object)) out.add(name);
    return out;
  };
  const bind = (target, depth) => {
    if (!target || typeof target !== "object" || bound.has(target)) return;
    bound.add(target);
    compat.retain(target);
    for (const name of names(target)) {
      // Constructors and enums (PageStateMatcher, ExecutionWorld) stay as they are.
      if (name === "constructor" || /^[A-Z]/.test(name)) continue;
      let value;
      try {
        value = target[name];
      } catch {
        continue;
      }
      if (typeof value === "function") {
        if (Object.prototype.hasOwnProperty.call(target, name) && value.__mistyBound) continue;
        const fixed = value.bind(target);
        Object.defineProperty(fixed, "__mistyBound", { value: true });
        try {
          Object.defineProperty(target, name, { value: fixed, configurable: true, writable: true, enumerable: true });
        } catch {
          // A frozen WebKit object keeps its own behavior.
        }
      } else if (depth > 0 && value && typeof value === "object" && !Array.isArray(value)) {
        // storage.local, devtools.panels, runtime.onMessage and similar.
        bind(value, depth - 1);
      }
    }
  };
  for (const root of new Set([globalThis.browser, globalThis.chrome].filter(Boolean)))
    for (const name of names(root)) {
      let namespace;
      try {
        namespace = root[name];
      } catch {
        continue;
      }
      bind(namespace, 2);
    }
})();
