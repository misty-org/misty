// Misty page-state runtime. Installed once per page. On macOS it lives in a
// dedicated WKContentWorld: page scripts cannot see, call or patch it, while
// the DOM is shared. It never submits forms or leaves the page's origin.
globalThis.__mistyPageState ??= (() => {
  const MAX_FIELDS = 400;
  const MAX_VALUE = 4096;
  const state = { dirty: true, userAt: 0, guard: false, refs: new Map(), nextRef: 1 };
  const trusted = (e) => e.isTrusted;
  const markDirty = (e) => {
    state.dirty = true;
    if (trusted(e)) state.userAt = Date.now();
  };
  for (const type of ["input", "change", "click", "keydown"]) {
    addEventListener(type, markDirty, true);
  }
  addEventListener("scroll", () => (state.dirty = true), { capture: true, passive: true });
  // While an agent restores, nothing may submit or navigate away.
  addEventListener(
    "submit",
    (e) => {
      if (!state.guard) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  addEventListener(
    "keydown",
    (e) => {
      if (!state.guard || e.isTrusted || e.key !== "Enter") return;
      const t = e.target;
      if (t instanceof HTMLInputElement) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  const text = (s, n = 200) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const cssPath = (el) => {
    const parts = [];
    for (
      let node = el;
      node && node.nodeType === 1 && parts.length < 8;
      node = node.parentElement
    ) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      const index = parent
        ? [...parent.children].filter((c) => c.tagName === node.tagName).indexOf(node) + 1
        : 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
    }
    return parts.join(">");
  };
  const labelOf = (el) => {
    if (el.labels && el.labels.length) return text(el.labels[0].textContent);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const ref = document.getElementById(by.split(/\s+/)[0]);
      if (ref) return text(ref.textContent);
    }
    return text(el.getAttribute("aria-label") || el.closest("label")?.textContent || "");
  };
  const fieldEls = () =>
    [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => !["hidden", "submit", "button", "image", "reset", "file"].includes(el.type))
      .slice(0, MAX_FIELDS);
  const keyOf = (el, i) => {
    const form = el.form ? [...document.forms].indexOf(el.form) : -1;
    return [
      form,
      el.tagName.toLowerCase(),
      el.type || "",
      el.name || el.id || labelOf(el) || `#${i}`,
    ].join("|");
  };
  const meta = (el, i) => ({
    key: keyOf(el, i),
    tag: el.tagName.toLowerCase(),
    type: el.type || "",
    name: el.name || "",
    id: el.id || "",
    autocomplete: el.getAttribute("autocomplete") || "",
    label: labelOf(el),
    placeholder: text(el.getAttribute("placeholder") || ""),
    visible: visible(el),
    locators: [
      el.id ? ["id", el.id] : null,
      el.name ? ["name", el.name] : null,
      labelOf(el) ? ["label", labelOf(el)] : null,
      ["css", cssPath(el)],
    ].filter(Boolean),
  });
  const valueOf = (el) => {
    if (el.type === "checkbox" || el.type === "radio") return { checked: el.checked };
    if (el.tagName === "SELECT") return { selected: [...el.selectedOptions].map((o) => o.value) };
    return { value: String(el.value || "").slice(0, MAX_VALUE) };
  };
  const find = (locators, tag, type) => {
    for (const [by, v] of locators) {
      let el = null;
      try {
        if (by === "id") el = document.getElementById(v);
        else if (by === "name") el = document.getElementsByName(v)[0];
        else if (by === "css") el = document.querySelector(v);
        else if (by === "label") el = fieldEls().find((candidate) => labelOf(candidate) === v);
      } catch {
        el = null;
      }
      if (el && el.tagName.toLowerCase() === tag && (!type || (el.type || "") === type)) return el;
    }
    return null;
  };
  const uiState = () => ({
    tabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
      .map((t) => text(t.textContent, 80))
      .slice(0, 40),
    expanded: [...document.querySelectorAll('[aria-expanded="true"]')]
      .map((t) => text(t.textContent, 80))
      .filter(Boolean)
      .slice(0, 40),
    details: [...document.querySelectorAll("details[open] > summary")]
      .map((s) => text(s.textContent, 80))
      .slice(0, 40),
  });
  const fingerprint = () =>
    [
      document.title,
      ...fieldEls()
        .filter(visible)
        .map((el, i) => keyOf(el, i)),
    ]
      .join("\n")
      .slice(0, 8000);

  // Native code classifies metadata, then asks only for permitted values.
  function describe(force) {
    if (!force && !state.dirty) return null;
    state.dirty = false;
    return {
      url: location.href,
      title: document.title,
      scroll: { x: scrollX, y: scrollY },
      fields: fieldEls().map(meta),
      ui: uiState(),
      media: [...document.querySelectorAll("video, audio")]
        .filter((m) => m.currentSrc && m.currentTime > 0)
        .slice(0, 8)
        .map((m) => ({ css: cssPath(m), time: m.currentTime })),
      fingerprint: fingerprint(),
      user_at: state.userAt,
    };
  }
  function values(keys) {
    const wanted = new Set(keys);
    return fieldEls().flatMap((el, i) => {
      const key = keyOf(el, i);
      return wanted.has(key) ? [{ key, ...valueOf(el) }] : [];
    });
  }

  const setValue = (el, value) => {
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const applyField = (el, f) => {
    if (el.disabled || el.readOnly) return false;
    if ("checked" in f) {
      if (el.checked !== f.checked) el.click();
      return el.checked === f.checked;
    }
    if ("selected" in f) {
      for (const o of el.options) o.selected = f.selected.includes(o.value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return f.selected.every((v) => [...el.selectedOptions].some((o) => o.value === v));
    }
    if ("value" in f) {
      if (el.value !== f.value) setValue(el, f.value);
      return el.value === f.value;
    }
    return false;
  };
  // Deterministic restore. Secret fields carry no value and are only marked.
  // Synchronous on purpose: WebView2's ExecuteScript cannot await promises.
  function apply(saved) {
    const out = { applied: 0, unmatched: [], secrets: 0, fingerprint_match: false };
    try {
      const target = new URL(saved.url);
      if (
        target.origin === location.origin &&
        target.pathname === location.pathname &&
        target.hash !== location.hash
      )
        location.hash = target.hash;
    } catch {}
    for (const label of saved.ui?.expanded || []) {
      const el = [...document.querySelectorAll('[aria-expanded="false"]')].find(
        (t) => text(t.textContent, 80) === label,
      );
      if (el && !(el instanceof HTMLAnchorElement && el.href)) el.click();
    }
    for (const label of saved.ui?.details || []) {
      const s = [...document.querySelectorAll("details:not([open]) > summary")].find(
        (t) => text(t.textContent, 80) === label,
      );
      if (s) s.parentElement.open = true;
    }
    for (const label of saved.ui?.tabs || []) {
      const t = [...document.querySelectorAll('[role="tab"][aria-selected="false"]')].find(
        (x) => text(x.textContent, 80) === label,
      );
      if (t) t.click();
    }
    for (const f of saved.fields || []) {
      const el = find(f.locators || [], f.tag, f.type);
      if (f.class === "secret") {
        if (el) {
          el.style.outline = "2px solid #e0a100";
          el.title = el.title || "Fill this in again";
          out.secrets++;
        }
        continue;
      }
      if (!("value" in f || "checked" in f || "selected" in f)) continue;
      if (el && visible(el) && applyField(el, f)) out.applied++;
      else out.unmatched.push(f.key);
    }
    if (saved.scroll) scrollTo(saved.scroll.x || 0, saved.scroll.y || 0);
    for (const m of saved.media || []) {
      try {
        const el = document.querySelector(m.css);
        if (el && "currentTime" in el) el.currentTime = m.time;
      } catch {}
    }
    out.fingerprint_match = fingerprint() === saved.fingerprint;
    state.dirty = true;
    return out;
  }

  // Controls an agent may act on, addressed by opaque refs valid for this page.
  function controls() {
    state.refs.clear();
    const items = [];
    const push = (el, role) => {
      if (!visible(el) || items.length >= 200) return;
      const ref = String(state.nextRef++);
      state.refs.set(ref, el);
      items.push({
        ref,
        role,
        i: items.length,
        ...meta(el, items.length),
        text: text(el.textContent, 120),
      });
    };
    fieldEls().forEach((el) => push(el, "field"));
    document
      .querySelectorAll('button, [role="button"], [role="tab"], a[href], summary, [aria-expanded]')
      .forEach((el) => push(el, "action"));
    return items;
  }
  const submitLike = (el) =>
    (el instanceof HTMLButtonElement &&
      (el.type === "submit" || (!el.getAttribute("type") && el.form))) ||
    (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image"));
  function act(a) {
    const el = state.refs.get(String(a.ref || ""));
    if (a.type === "scroll") {
      scrollBy(0, Math.max(-2000, Math.min(2000, Number(a.dy) || 0)));
      return { ok: true };
    }
    if (!el || !el.isConnected) return { ok: false, error: "stale_ref" };
    if (a.type === "click") {
      if (submitLike(el)) return { ok: false, error: "submit_blocked" };
      const link = el.closest("a[href]");
      if (link && new URL(link.href, location.href).origin !== location.origin)
        return { ok: false, error: "navigation_blocked" };
      el.click();
      return { ok: true };
    }
    if (
      a.type === "type" &&
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    ) {
      setValue(el, String(a.value ?? "").slice(0, MAX_VALUE));
      return { ok: true };
    }
    if (a.type === "select" && el instanceof HTMLSelectElement) {
      const option = [...el.options].find(
        (o) => o.value === a.value || text(o.textContent) === a.value,
      );
      if (!option) return { ok: false, error: "no_option" };
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    if (a.type === "check" && el instanceof HTMLInputElement) {
      if (el.checked !== Boolean(a.value)) el.click();
      return { ok: true };
    }
    return { ok: false, error: "unsupported" };
  }

  return {
    run(cmd) {
      switch (cmd.op) {
        case "describe":
          return describe(Boolean(cmd.force));
        case "values":
          return values(cmd.keys || []);
        case "apply":
          return apply(cmd.state);
        case "controls":
          return controls();
        case "act":
          return act(cmd.action || {});
        case "guard":
          state.guard = Boolean(cmd.on);
          return { ok: true };
        case "user_at":
          return state.userAt;
        default:
          return null;
      }
    },
  };
})();
