((P) => {
  const ELEMENT_LIMIT = 20000;
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const same = (want, have) => squash(want).toLowerCase() === squash(have).toLowerCase();
  const shows = (el) => {
    if (!el?.isConnected || P.hidden(el)) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  const element = (check) => {
    const role = String(check.role || "");
    const name = check.name === undefined ? undefined : String(check.name);
    if (!role) return { passed: false, error: "An element check names a role." };
    const all = document.querySelectorAll("*");
    const found = [];
    for (let index = 0; index < all.length && index < ELEMENT_LIMIT; index++) {
      const el = all[index];
      if (P.role(el) !== role) continue;
      if (name !== undefined && !same(name, P.name(el, role))) continue;
      if (shows(el)) return { passed: true, found: P.describe(el) };
      found.push(el);
    }
    const what = name === undefined ? `a ${role}` : `a ${role} named “${P.clip(name, 80)}”`;
    return found.length
      ? { passed: false, error: `${what[0].toUpperCase()}${what.slice(1)} is on the page but not visible.` }
      : { passed: false, error: `No ${what.slice(2)} on the page.` };
  };

  const text = (check) => {
    const phrase = squash(check.text).toLowerCase();
    if (!phrase) return { passed: false, error: "A text check gives the text." };
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let hidden = false;
    for (let node = walker.nextNode(), seen = 0; node && seen < ELEMENT_LIMIT * 5; node = walker.nextNode(), seen++) {
      const parent = node.parentElement;
      if (!parent || !squash(node.data).toLowerCase().includes(phrase)) continue;
      if (shows(parent)) return { passed: true, found: P.clip(squash(node.data), 120) };
      hidden = true;
    }
    for (const field of document.querySelectorAll("input, textarea")) {
      if (squash(field.value).toLowerCase().includes(phrase) && shows(field) && !P.secret(field)) {
        return { passed: true, found: P.describe(field) };
      }
    }
    const whole = squash(document.body?.innerText).toLowerCase();
    if (whole.includes(phrase)) return { passed: true, found: P.clip(squash(check.text), 120) };
    return { passed: false, error: hidden ? "That text is on the page but not visible." : "That text is not on the page." };
  };

  const target = (check, documentId) => {
    const resolved = P.resolve(documentId, check.ref);
    if (!resolved.ok) return { failed: { passed: false, ...(resolved.errorCode ? { errorCode: resolved.errorCode } : {}), error: resolved.error } };
    if (!resolved.el) return { failed: { passed: false, error: "Name the element with a ref from the latest snapshot." } };
    return { el: resolved.el };
  };

  const ITEM_ROLES = new Set(["listitem", "option", "row", "treeitem", "menuitem", "tab", "article"]);
  const list = (check, documentId) => {
    const { el, failed } = target(check, documentId);
    if (failed) return failed;
    const items = Array.isArray(check.items) ? check.items.map(squash).filter(Boolean) : [];
    if (!items.length) return { passed: false, error: "A list check gives the items." };
    const texts = [];
    for (const child of el.querySelectorAll("*")) {
      if (texts.length >= 500) break;
      if (ITEM_ROLES.has(P.role(child)) && shows(child)) texts.push(squash(child.innerText || child.textContent).toLowerCase());
    }
    if (!texts.length) for (const child of el.children) if (shows(child)) texts.push(squash(child.innerText || child.textContent).toLowerCase());
    const missing = items.filter((item) => !texts.some((have) => have.includes(item.toLowerCase())));
    return missing.length
      ? { passed: false, error: `Not in the list: ${missing.map((item) => `“${P.clip(item, 60)}”`).join(", ")}.`, items: texts.length }
      : { passed: true, items: texts.length };
  };

  const valueOf = (el) => {
    const role = P.role(el);
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) return String(el.checked);
    if (role === "checkbox" || role === "radio" || role === "switch" || role === "menuitemcheckbox") {
      return String(el.getAttribute("aria-checked") === "true");
    }
    if (el.tagName === "SELECT") return squash([...el.selectedOptions].map((option) => option.label || option.text).join(", "));
    if ("value" in el && typeof el.value === "string") return el.value;
    if (el.getAttribute("aria-valuenow") !== null) return el.getAttribute("aria-valuetext") || el.getAttribute("aria-valuenow");
    return el.isContentEditable ? el.innerText : squash(el.textContent);
  };

  const value = (check, documentId) => {
    const { el, failed } = target(check, documentId);
    if (failed) return failed;
    if (P.secret(el)) return { passed: false, error: "That field holds a secret; its value is never read." };
    const want = typeof check.value === "boolean" ? String(check.value) : String(check.value ?? "");
    const have = valueOf(el);
    return squash(have) === squash(want)
      ? { passed: true }
      : { passed: false, error: `Its value is “${P.clip(squash(have), 120)}”.`, value: P.clip(squash(have), 400) };
  };

  const kinds = { element, text, list, value };

  P.verify = (args) => {
    const checks = Array.isArray(args.checks) ? args.checks.slice(0, 20) : [];
    if (!checks.length) return { ok: false, attempted: false, errorCode: "browser_verify_invalid", error: "Give at least one check." };
    const results = checks.map((check) => {
      const run = kinds[check?.kind];
      if (!run) return { kind: check?.kind, passed: false, error: "A check is element, text, list or value." };
      return { kind: check.kind, ...run(check, args.documentId) };
    });
    return { ok: true, passed: results.every((result) => result.passed), checks: results };
  };

  P.viewInfo = () => ({
    ok: true,
    width: innerWidth,
    height: innerHeight,
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    media: matchMedia("print").matches ? "print" : "screen",
  });

  P.pageTools = () => new Promise((resolve) => {
    let done = false;
    const take = (event) => {
      if (done) return;
      done = true;
      document.removeEventListener("misty:webmcp-tools", take);
      let listed = {};
      try { listed = JSON.parse(String(event.detail)); } catch {}
      const tools = (listed.tools || []).slice(0, 100).map((tool) => ({
        name: P.clip(String(tool.name || ""), 128),
        ...(tool.title ? { title: P.clip(String(tool.title), 200) } : {}),
        description: P.clip(String(tool.description || ""), 2000),
        inputSchema: tool.inputSchema || { type: "object" },
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      }));
      resolve({ ok: true, watched: true, tools });
    };
    document.addEventListener("misty:webmcp-tools", take);
    document.dispatchEvent(new CustomEvent("misty:webmcp-list"));
    setTimeout(() => {
      if (done) return;
      done = true;
      document.removeEventListener("misty:webmcp-tools", take);
      resolve({ ok: true, watched: false, tools: [] });
    }, 1500);
  });

  P.pageToolCall = (args) => new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      document.removeEventListener("misty:webmcp-result", take);
      resolve(answer);
    };
    const take = (event) => {
      let answer;
      try { answer = JSON.parse(String(event.detail)); } catch { return; }
      if (answer.id !== id) return;
      if (!answer.ok) return finish({ ok: false, attempted: true, errorCode: "browser_page_tool_failed", error: P.clip(String(answer.error || "The page's tool failed."), 1000) });
      const text = JSON.stringify(answer.result ?? null);
      finish(text.length > 20000
        ? { ok: true, result: text.slice(0, 20000), truncated: true }
        : { ok: true, result: answer.result ?? null });
    };
    document.addEventListener("misty:webmcp-result", take);
    document.dispatchEvent(new CustomEvent("misty:webmcp-call", { detail: JSON.stringify({ id, name: String(args.name || ""), args: args.args || {} }) }));
    setTimeout(() => finish({ ok: false, attempted: true, errorCode: "browser_page_tool_timeout", error: "The page's tool didn't answer within 30 seconds." }), Math.min(30000, Number(args.timeoutMs) || 30000));
  });

  const HOST = "data-misty-highlight";
  const marks = new Map();
  let layer = null;
  let watching = false;
  const place = () => {
    for (const [ref, mark] of marks) {
      if (!mark.el.isConnected) {
        mark.box.remove();
        marks.delete(ref);
        continue;
      }
      const box = mark.el.getBoundingClientRect();
      Object.assign(mark.box.style, {
        left: `${box.left - 3}px`, top: `${box.top - 3}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px`,
      });
    }
  };
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; place(); });
  };
  const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
  const ensureLayer = () => {
    if (layer?.isConnected) return layer;
    const host = document.createElement("div");
    host.setAttribute(HOST, "");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ".mark{position:fixed;box-sizing:border-box;border:2px solid rgb(59,130,246);border-radius:6px;background:rgba(59,130,246,.12)}" +
      ".tag{position:absolute;left:-2px;bottom:100%;margin-bottom:3px;padding:1px 6px;border-radius:4px;background:rgb(59,130,246);color:#fff;font:600 12px/18px system-ui,sans-serif;white-space:nowrap}";
    root.append(style);
    host.__mistyRoot = root;
    document.documentElement.append(host);
    layer = host;
    if (!watching) {
      watching = true;
      addEventListener("scroll", later, { capture: true, passive: true });
      addEventListener("resize", later, { passive: true });
    }
    return layer;
  };

  P.highlight = (args) => {
    const refs = Array.isArray(args.refs) ? args.refs : args.ref ? [args.ref] : [];
    if (!refs.length) return { ok: false, attempted: false, errorCode: "browser_highlight_invalid", error: "Name an element with a ref from the latest snapshot." };
    for (const ref of refs.slice(0, 20)) {
      const resolved = P.resolve(args.documentId, ref);
      if (!resolved.ok || !resolved.el) return { ok: false, attempted: false, ...(resolved.errorCode ? { errorCode: resolved.errorCode } : {}), error: resolved.error || "Name an element with a ref." };
      const root = ensureLayer().__mistyRoot;
      marks.get(ref)?.box.remove();
      const box = document.createElement("div");
      box.className = "mark";
      if (typeof args.label === "string" && args.label.trim()) {
        const tag = document.createElement("div");
        tag.className = "tag";
        tag.textContent = P.clip(args.label.trim(), 80);
        box.append(tag);
      }
      root.append(box);
      marks.set(ref, { el: resolved.el, box });
      resizes?.observe(resolved.el);
    }
    place();
    return { ok: true, highlighted: [...marks.keys()] };
  };

  P.highlightClear = (args) => {
    const refs = Array.isArray(args.refs) ? args.refs : args.ref ? [args.ref] : [...marks.keys()];
    for (const ref of refs) {
      const mark = marks.get(ref);
      if (!mark) continue;
      resizes?.unobserve(mark.el);
      mark.box.remove();
      marks.delete(ref);
    }
    if (!marks.size && layer) {
      layer.remove();
      layer = null;
    }
    return { ok: true, highlighted: [...marks.keys()] };
  };

})(globalThis.__mistyAgentPageV1 ??= {});
