// SPDX-License-Identifier: MIT
(() => {
  const send = (value) => window.webkit.messageHandlers.mistyExtensionSync.postMessage(value);
  let remote = Promise.resolve();
  const expected = new Map();
  const canonical = (value) => JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const local = Object.create(null);
    for (const [key, change] of Object.entries(changes)) {
      const value = Object.hasOwn(change, "newValue") ? { value: change.newValue } : { deleted: true };
      if (expected.has(key) && canonical(expected.get(key)) === canonical(value)) expected.delete(key);
      else local[key] = value;
    }
    if (Object.keys(local).length) send({ kind: "sync-change", changes: local });
  });
  window.mistyApplySync = (changes) => {
    remote = remote.catch(() => {}).then(async () => {
      const before = await browser.storage.sync.get(Object.keys(changes));
      const writes = Object.create(null), removals = [];
      for (const [key, change] of Object.entries(changes)) {
        const existing = Object.hasOwn(before, key) ? { value: before[key] } : { deleted: true };
        if (canonical(existing) === canonical(change)) continue;
        expected.set(key, change);
        if (change.deleted === true) removals.push(key); else writes[key] = change.value;
      }
      try {
        // WebKit's extension argument validator expects an ordinary object.
        // Spread preserves own keys such as __proto__ without invoking setters.
        if (Object.keys(writes).length) await browser.storage.sync.set({ ...writes });
        if (removals.length) await browser.storage.sync.remove(removals);
      } catch (error) {
        for (const key of Object.keys(changes)) expected.delete(key);
        throw error;
      }
      return true;
    });
    return remote;
  };
  browser.storage.sync.get(null).then((values) => send({ kind: "sync-ready", values }))
    .catch(() => send({ kind: "sync-error" }));
})();
