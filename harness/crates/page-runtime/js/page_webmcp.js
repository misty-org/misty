(() => {
  const key = Symbol.for("misty.webmcp");
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const native = navigator.modelContext || document.modelContext;
  const tools = new Map();
  const events = new EventTarget();
  const changed = () => events.dispatchEvent(new Event("toolchange"));
  const describe = (tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: "object" },
    annotations: tool.annotations,
  });
  const context = native || {
    registerTool(tool, options) {
      const name = String(tool?.name || "");
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) throw new TypeError("A tool needs a name of letters, digits, _, . or -.");
      if (typeof tool.execute !== "function") throw new TypeError("A tool needs execute.");
      tools.set(name, tool);
      options?.signal?.addEventListener("abort", () => {
        if (tools.get(name) === tool) { tools.delete(name); changed(); }
      }, { once: true });
      changed();
      return { unregister: () => { if (tools.get(name) === tool) { tools.delete(name); changed(); } } };
    },
    unregisterTool(name) {
      if (tools.delete(String(name))) changed();
    },
    provideContext(given) {
      tools.clear();
      for (const tool of given?.tools || []) if (tool?.name && typeof tool.execute === "function") tools.set(String(tool.name), tool);
      changed();
    },
    clearContext() {
      tools.clear();
      changed();
    },
    getTools() {
      return [...tools.values()].map(describe);
    },
    async executeTool(described, input) {
      const tool = tools.get(described?.name ?? described);
      if (!tool) throw new Error(`There is no tool called ${described?.name ?? described}.`);
      return tool.execute(input || {}, { requestUserInteraction: async (run) => run() });
    },
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
  };
  if (!native) {
    for (const owner of [navigator, document]) {
      try { Object.defineProperty(owner, "modelContext", { value: context, configurable: true }); } catch {}
    }
  }
  const answer = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(detail) }));
  document.addEventListener("misty:webmcp-list", async () => {
    try {
      const listed = await Promise.resolve(context.getTools?.() ?? []);
      answer("misty:webmcp-tools", { tools: (listed || []).map(describe) });
    } catch (error) {
      answer("misty:webmcp-tools", { tools: [], error: String(error?.message || error) });
    }
  });
  document.addEventListener("misty:webmcp-call", async (event) => {
    let asked;
    try { asked = JSON.parse(String(event.detail)); } catch { return; }
    try {
      const listed = (await Promise.resolve(context.getTools?.() ?? [])) || [];
      const found = listed.find((tool) => tool.name === asked.name);
      if (!found) throw new Error(`This page has no tool called ${asked.name}.`);
      let result = await context.executeTool(found, asked.args || {});
      if (typeof result === "string") { try { result = JSON.parse(result); } catch {} }
      answer("misty:webmcp-result", { id: asked.id, ok: true, result: result === undefined ? null : result });
    } catch (error) {
      answer("misty:webmcp-result", { id: asked.id, ok: false, error: String(error?.message || error) });
    }
  });
})();
