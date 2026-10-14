// SPDX-License-Identifier: MIT
// Chrome's and Firefox's userScripts API (Tampermonkey, Violentmonkey and other
// script managers), which WebKit lacks. WebKit registers scripts only from files,
// so Misty's native host stores each script's code as a file in the extension's
// own package (__misty_user_scripts__/) and the script is registered as a content
// script. Host permissions apply exactly as they do to content scripts.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const { api, call, method, namespace, declared } = compat;
  if (!declared("userScripts") || !api.scripting?.registerContentScripts) return;

  const prefix = "__misty_user_script__";
  const scripts = new Map();
  const worlds = new Map();

  // Kept in this extension's own IndexedDB, so scripts survive restarts and
  // updates the way Chrome keeps them.
  const database = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open("__misty_user_scripts__", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const transact = async (mode, work) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("state", mode);
      const request = work(transaction.objectStore("state"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  };
  const save = () =>
    transact("readwrite", (store) =>
      store.put({ scripts: [...scripts.values()], worlds: [...worlds.values()] }, "state"),
    ).catch(() => {});
  // The background and the extension's own pages share one stored state, so each
  // call reads it fresh rather than trusting this context's copy.
  const refresh = () =>
    (globalThis.indexedDB ? transact("readonly", (store) => store.get("state")) : Promise.resolve(null))
      .then((state) => {
        if (!state) return;
        scripts.clear();
        worlds.clear();
        for (const script of state.scripts ?? []) scripts.set(script.id, script);
        for (const world of state.worlds ?? []) worlds.set(world.worldId ?? "", world);
      })
      .catch(() => {});
  const loaded = refresh();

  /** Each source as a package file: files stay, code is stored by Misty. */
  const files = (sources = []) =>
    Promise.all(
      sources.map((source) =>
        source.file ? String(source.file).replace(/^\//, "") : call("userScripts.write", String(source.code ?? "")),
      ),
    );
  const contentScript = async (script) => ({
    id: prefix + script.id,
    matches: script.matches ?? [],
    ...(script.excludeMatches ? { excludeMatches: script.excludeMatches } : {}),
    js: await files(script.js),
    allFrames: Boolean(script.allFrames),
    runAt: script.runAt ?? "document_idle",
    // USER_SCRIPT worlds run as isolated content scripts; MAIN runs in the page.
    world: script.world === "MAIN" ? "MAIN" : "ISOLATED",
    persistAcrossSessions: false,
  });
  // Older WebKit releases reject `world`; scripts then run isolated.
  const registerAll = async (list) => {
    if (!list.length) return;
    const content = await Promise.all(list.map(contentScript));
    try {
      await api.scripting.registerContentScripts(content);
    } catch (error) {
      if (!content.some((item) => item.world === "MAIN")) throw error;
      await api.scripting.registerContentScripts(content.map(({ world, ...item }) => item));
    }
  };
  const unregisterAll = async (ids) => {
    const registered = await api.scripting.getRegisteredContentScripts().catch(() => []);
    const ours = registered.map((item) => item.id).filter((id) => id.startsWith(prefix));
    const wanted = ids ? ours.filter((id) => ids.includes(id.slice(prefix.length))) : ours;
    if (wanted.length) await api.scripting.unregisterContentScripts({ ids: wanted });
  };
  const chosen = (filter = {}) =>
    [...scripts.values()].filter((script) => !Array.isArray(filter.ids) || filter.ids.includes(script.id));
  const valid = (script) => {
    if (!script || typeof script.id !== "string" || !script.id || script.id.startsWith("_"))
      throw new Error("Each user script needs an id that doesn't start with an underscore.");
    if (!Array.isArray(script.js) || !script.js.length)
      throw new Error(`User script ${script.id} needs at least one js source.`);
    return script;
  };

  // The background restores registrations once per start.
  if (compat.background)
    void loaded.then(async () => {
      await unregisterAll().catch(() => {});
      await registerAll([...scripts.values()]).catch(() => {});
    });

  namespace("userScripts", {
    ExecutionWorld: { MAIN: "MAIN", USER_SCRIPT: "USER_SCRIPT" },
    register: method(async (list = []) => {
      await refresh();
      for (const script of list) {
        valid(script);
        if (scripts.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'.`);
      }
      await registerAll(list);
      for (const script of list) scripts.set(script.id, script);
      await save();
    }),
    update: method(async (list = []) => {
      await refresh();
      const next = list.map((change) => {
        const current = scripts.get(change?.id);
        if (!current) throw new Error(`No user script with id '${change?.id}'.`);
        return valid({ ...current, ...change });
      });
      await unregisterAll(next.map((script) => script.id));
      await registerAll(next);
      for (const script of next) scripts.set(script.id, script);
      await save();
    }),
    unregister: method(async (filter) => {
      await refresh();
      const ids = chosen(filter).map((script) => script.id);
      await unregisterAll(ids);
      for (const id of ids) scripts.delete(id);
      await save();
    }),
    getScripts: method(async (filter) => {
      await refresh();
      return chosen(filter);
    }),
    // Worlds keep their settings; Misty runs user scripts with the content-script policy.
    configureWorld: method(async (properties = {}) => {
      await refresh();
      worlds.set(properties.worldId ?? "", { ...properties });
      await save();
    }),
    getWorldConfigurations: method(async () => {
      await refresh();
      return [...worlds.values()];
    }),
    resetWorldConfiguration: method(async (worldId) => {
      await refresh();
      worlds.delete(worldId ?? "");
      await save();
    }),
    execute: method(async ({ target, js, world, injectImmediately } = {}) => {
      if (!target || !Array.isArray(js) || !js.length) throw new Error("A target and js sources are required.");
      return api.scripting.executeScript({
        target,
        files: await files(js),
        ...(world === "MAIN" ? { world: "MAIN" } : {}),
        ...(injectImmediately ? { injectImmediately: true } : {}),
      });
    }),
  });
})();
