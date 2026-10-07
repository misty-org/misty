// SPDX-License-Identifier: MIT
// Shared plumbing for Misty's WebExtension compatibility layer. Misty loads it
// before an extension's own background scripts and pages. The system WebKit
// runtime omits several Firefox APIs; the shims define only what is missing and
// never replace an API that WebKit provides.
(() => {
  "use strict";
  const api = globalThis.browser;
  if (!api || globalThis.__mistyCompat) return;
  const manifest = api.runtime.getManifest();
  const declared = new Set([
    ...(manifest.permissions ?? []),
    ...(manifest.optional_permissions ?? []),
  ]);
  const channel = new BroadcastChannel("misty-compat");
  const pending = new Map();
  const listeners = new Map();
  const identityWaiters = new Set();
  // WebKit API objects are wrappers it may collect and recreate, dropping any
  // property added to them. Holding each extended object keeps its wrapper.
  const retained = new Set();
  let sequence = 0;
  let announceReady;
  const ready = new Promise((resolve) => (announceReady = resolve));
  const prefix = Math.random().toString(36).slice(2);

  channel.onmessage = ({ data }) => {
    if (!data || typeof data !== "object") return;
    if (data.ready) announceReady();
    else if (typeof data.reply === "string" && pending.has(data.reply)) {
      const waiter = pending.get(data.reply);
      pending.delete(data.reply);
      if (typeof data.error === "string") waiter.reject(new Error(data.error));
      else waiter.resolve(data.result ?? undefined);
    } else if (typeof data.event === "string") emit(data.event, data.args ?? []);
    else if (typeof data.identity === "string")
      for (const waiter of identityWaiters) waiter(data.identity);
  };
  channel.postMessage({ hello: true });

  function plain(value) {
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }
  /** Sends one request to Misty through this extension's private host page. */
  async function call(method, ...args) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Misty's extension host is not available.")), 10000),
    );
    await Promise.race([ready, timeout]);
    const request = `${prefix}-${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(request, { resolve, reject });
      channel.postMessage({ request, method, args: args.map(plain) });
      setTimeout(() => {
        if (pending.delete(request)) reject(new Error(`${method} did not respond.`));
      }, 60000);
    });
  }
  function emit(name, args) {
    for (const listener of listeners.get(name) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        console.error(error);
      }
    }
  }
  /** An extension event object. `started` runs when the first listener is added. */
  function event(name, started) {
    const set = new Set();
    listeners.set(name, set);
    return {
      addListener(listener) {
        if (typeof listener !== "function") return;
        set.add(listener);
        if (set.size === 1) started?.();
      },
      removeListener: (listener) => void set.delete(listener),
      hasListener: (listener) => set.has(listener),
      hasListeners: () => set.size > 0,
    };
  }
  /** Promise-returning method that also accepts a trailing Chrome-style callback. */
  function method(implementation) {
    return function (...args) {
      const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
      const result = Promise.resolve().then(() => implementation(...args));
      if (!callback) return result;
      result.then(
        (value) => callback(value),
        (error) => {
          console.warn(error);
          callback();
        },
      );
    };
  }
  const unsupported = (message) => method(() => Promise.reject(new Error(message)));
  const resolved = (value) => method(() => value);
  function define(target, name, value) {
    if (!target) return;
    retained.add(target);
    // WebKit can declare an API it leaves undefined; only a real value counts.
    if (target[name] !== undefined) return;
    try {
      Object.defineProperty(target, name, {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    } catch {
      // A frozen WebKit object keeps its own shape.
    }
  }
  /** Adds a namespace to `browser` and, when separate, `chrome`. */
  function namespace(name, value) {
    define(api, name, value);
    if (globalThis.chrome && globalThis.chrome !== api) define(globalThis.chrome, name, value);
  }
  Object.defineProperty(globalThis, "__mistyCompat", {
    value: Object.freeze({
      api,
      manifest,
      declared: (permission) => declared.has(permission),
      call,
      emit,
      event,
      method,
      unsupported,
      resolved,
      define,
      namespace,
      retain: (target) => retained.add(target),
      identityWaiters,
    }),
  });
})();
