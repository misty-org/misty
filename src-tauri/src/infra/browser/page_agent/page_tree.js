// Misty agent page runtime, part 2 of 4: the accessibility tree, its text
// snapshot with refs, element search and Markdown for extraction.
((P) => {
  const S = P.state;
  const MAX_SCAN = 25000;
  // Roles that become a line of their own even without a ref.
  const STRUCTURE = new Set(["navigation", "main", "complementary", "form", "dialog", "alertdialog", "alert", "region",
    "article", "banner", "contentinfo", "search", "group", "radiogroup", "toolbar", "menu", "menubar", "tablist",
    "tabpanel", "tree", "grid", "treegrid", "table", "row", "cell", "rowheader", "list", "listitem", "heading", "img",
    "status", "progressbar", "meter", "iframe"]);
  // Interactive roles whose name already says everything inside them.
  const LEAF = new Set(["button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "spinbutton", "slider",
    "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "heading", "img", "clickable", "columnheader"]);
  const cursorCache = new WeakMap();
  const cursorOf = (el) => {
    if (!cursorCache.has(el)) cursorCache.set(el, el.ownerDocument.defaultView.getComputedStyle(el).cursor);
    return cursorCache.get(el);
  };

  const states = (el, role, node) => {
    const aria = (name) => el.getAttribute(name);
    const props = node.props;
    if (role === "heading") props.push(`level=${aria("aria-level") || el.tagName.slice(1) || 2}`);
    if (["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"].includes(role)) {
      const checked = el.tagName === "INPUT" ? (el.indeterminate ? "mixed" : String(el.checked)) : aria("aria-checked");
      props.push(checked === "true" ? "checked" : checked === "mixed" ? "mixed" : "unchecked");
    }
    if (aria("aria-pressed") === "true") props.push("pressed");
    if (aria("aria-expanded")) props.push(aria("aria-expanded") === "true" ? "expanded" : "collapsed");
    if (aria("aria-selected") === "true" || (el.tagName === "OPTION" && el.selected)) props.push("selected");
    if (aria("aria-current") && aria("aria-current") !== "false") props.push("current");
    if (el.disabled || aria("aria-disabled") === "true") props.push("disabled");
    if (el.required || aria("aria-required") === "true") props.push("required");
    if (aria("aria-invalid") === "true" || (el.validity && el.willValidate && !el.validity.valid && el.value)) props.push("invalid");
    if (el.readOnly || aria("aria-readonly") === "true") props.push("readonly");
    if (role === "textbox" && (el.tagName === "TEXTAREA" || aria("aria-multiline") === "true" || el.isContentEditable)) props.push("multiline");
  };

  const valueOf = (el, role) => {
    if (el.tagName === "SELECT") return Array.from(el.selectedOptions).map((option) => option.text.trim()).join(", ");
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["checkbox", "radio", "button", "submit", "reset", "image", "file"].includes(type)) {
        return type === "file" && el.files?.length ? Array.from(el.files).map((file) => file.name).join(", ") : undefined;
      }
      return P.clip(el.value, 300);
    }
    if (role === "textbox" && el.isContentEditable) return P.clip(el.innerText ?? el.textContent, 300);
    if (["slider", "spinbutton", "progressbar", "meter"].includes(role)) return el.getAttribute("aria-valuetext") || el.getAttribute("aria-valuenow") || el.value;
    if (role === "combobox") return P.clip(el.getAttribute("aria-valuetext") || el.value || "", 200) || undefined;
    return undefined;
  };

  const linkUrl = (el) => {
    const href = el.getAttribute("href");
    if (!href || href.startsWith("javascript:")) return "";
    try {
      const url = new URL(href, el.baseURI);
      return P.clip(url.origin === location.origin ? url.pathname + url.search + url.hash : url.href, 120);
    } catch { return ""; }
  };

  /** Builds the visible accessibility tree under root, registering refs. */
  P.build = (root, limits = {}) => {
    const maxRefs = limits.maxRefs ?? 800;
    const tree = { role: "root", children: [], props: [] };
    let scanned = 0;
    let refs = 0;
    let scanLimited = false;
    const interactive = [];
    const pushText = (parent, raw) => {
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) return;
      const last = parent.children[parent.children.length - 1];
      if (last && last.text !== undefined && !last.closed) last.text = `${last.text} ${text}`;
      else parent.children.push({ text });
    };
    const close = (parent) => {
      const last = parent.children[parent.children.length - 1];
      if (last && last.text !== undefined) last.closed = true;
    };
    const visitChildren = (el, parent, textHidden) => {
      const kids = el.shadowRoot ? el.shadowRoot.childNodes
        : el.tagName === "SLOT" ? el.assignedNodes({ flatten: true }) : el.childNodes;
      for (const child of kids) {
        if (scanLimited) return;
        if (child.nodeType === 3) { if (!textHidden) pushText(parent, child.data); }
        else if (child.nodeType === 1) visit(child, parent);
      }
    };
    const visit = (el, parent) => {
      if (++scanned > MAX_SCAN) { scanLimited = true; return; }
      if (P.hiddenSelf(el)) return;
      const view = el.ownerDocument.defaultView;
      const style = view.getComputedStyle(el);
      const invisible = style.visibility === "hidden" || style.visibility === "collapse";
      const block = !style.display.startsWith("inline") && style.display !== "contents";
      if (block) close(parent);
      let role = P.role(el);
      if (role === "iframe") {
        const node = { role: "iframe", name: P.name(el, role), children: [], props: [] };
        let doc = null;
        try { doc = el.contentDocument; } catch { doc = null; }
        // An editor frame's body is itself the editable area (CKEditor, TinyMCE): list the body.
        if (doc?.body && (doc.body.isContentEditable || doc.designMode === "on")) visit(doc.body, node);
        else if (doc?.body) visitChildren(doc.body, node, false);
        else {
          let origin = "";
          // A frame a script navigated (src empty or about:blank) is not the page's own origin.
          const src = el.getAttribute("src") || "";
          try { origin = src && !src.startsWith("about:") ? new URL(src, el.baseURI).origin : ""; } catch { origin = ""; }
          node.props.push(origin ? `cross-origin ${origin}` : "cross-origin");
        }
        parent.children.push(node);
        close(parent);
        return;
      }
      const secret = P.secret(el);
      let clickable = false;
      if (!role && !invisible && el !== el.ownerDocument.body) {
        const parentEl = el.parentElement;
        const tabbable = el.hasAttribute("tabindex") && el.tabIndex >= 0;
        const pointer = cursorOf(el) === "pointer" && (!parentEl || cursorOf(parentEl) !== "pointer");
        clickable = tabbable || el.hasAttribute("onclick") || pointer;
        if (clickable) role = "clickable";
      }
      const scrollable = block && el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement &&
        ((/(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
         (/(auto|scroll|overlay)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1));
      const acts = !invisible && (P.interactiveRoles.has(role) || clickable);
      if (!acts && !scrollable && !STRUCTURE.has(role)) {
        visitChildren(el, parent, invisible);
        if (block) close(parent);
        return;
      }
      const node = { role: role || "generic", name: role ? P.name(el, role) : "", children: [], props: [] };
      if (acts || scrollable) {
        if (secret) node.props.push(`${secret} — only the person may enter it`);
        else if (refs < maxRefs) { node.ref = P.register(el); refs++; }
      }
      if (scrollable) node.props.push("scrollable");
      if (role) states(el, role, node);
      if (!secret) {
        const value = valueOf(el, role);
        if (value !== undefined && value !== "") node.value = value;
      }
      if (role === "link") node.url = linkUrl(el);
      if (el.tagName === "SELECT") {
        let count = 0;
        for (const option of el.options) {
          if (count++ >= 40) { node.children.push({ text: `… ${el.options.length - 40} more options` }); break; }
          node.children.push({ role: "option", name: P.clip(option.text, 100), children: [], props: option.selected ? ["selected"] : option.disabled ? ["disabled"] : [] });
        }
      } else if (!(LEAF.has(node.role) && (node.name || node.ref))) {
        visitChildren(el, node, invisible);
      }
      if (node.ref) interactive.push(node);
      const empty = !node.name && !node.ref && !node.children.length && !node.value;
      if (!empty || node.role === "img") parent.children.push(node);
      if (block) close(parent);
    };
    if (root.nodeType === 9) visitChildren(root.body || root.documentElement, tree, false);
    else visit(root, tree);
    return { tree, interactive, scanLimited, refLimited: refs >= maxRefs };
  };

  const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  P.line = (node) => {
    let line = `- ${node.role}`;
    if (node.name) line += ` ${quote(node.name)}`;
    for (const prop of node.props) line += ` [${prop}]`;
    if (node.ref) line += ` [ref=${node.ref}]`;
    if (node.url) line += ` [url=${node.url}]`;
    if (node.value !== undefined) line += `: ${quote(P.clip(node.value, 300))}`;
    return line;
  };

  // Site menus (navigation, header, footer, sidebars) come first in most pages' order and used to
  // take the whole budget, so a long page's snapshot showed menus and cut off the content, search
  // box and filters the agent came for (docs/plans/agent-harness.md, Page layer). When a page doesn't fit,
  // each menu gets a small share and says how much it left out; the rest goes to the content.
  const CHROME = new Set(["navigation", "banner", "contentinfo", "complementary", "menubar"]);
  const CHROME_CHARS = 1500;
  const count = (node) => 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0);

  const render = (tree, maxChars, chromeCap) => {
    const lines = [];
    let chars = 0;
    let truncated = false;
    /** Adds a line within the page budget and, inside a menu, the menu's share. */
    const emit = (depth, line, box) => {
      if (truncated || box?.full) return false;
      const text = "  ".repeat(depth) + line;
      if (box && box.used + text.length + 1 > box.cap) { box.full = true; return false; }
      if (chars + text.length + 1 > maxChars) { truncated = true; return false; }
      lines.push(text);
      chars += text.length + 1;
      if (box) box.used += text.length + 1;
      return true;
    };
    const walk = (node, depth, box) => {
      for (const child of node.children) {
        if (truncated) return;
        if (box?.full) { box.skipped += count(child); continue; }
        if (child.text !== undefined) { if (!emit(depth, `- text: ${P.clip(child.text, 600)}`, box) && box) box.skipped++; continue; }
        const only = child.children.length === 1 && child.children[0].text !== undefined;
        if (only && !child.ref && !child.name && child.value === undefined) {
          if (!emit(depth, `${P.line(child)}: ${P.clip(child.children[0].text, 600)}`, box) && box) box.skipped++;
          continue;
        }
        if (!emit(depth, child.children.length ? `${P.line(child)}:` : P.line(child), box)) {
          if (box) box.skipped += count(child);
          continue;
        }
        if (!box && chromeCap < Infinity && CHROME.has(child.role)) {
          const menu = { cap: chromeCap, used: 0, skipped: 0, full: false };
          walk(child, depth + 1, menu);
          if (menu.skipped) emit(depth + 1, `- text: (${menu.skipped} more items in this ${child.role} left out so the page's content fits; browser_find searches them)`);
        } else walk(child, depth + 1, box);
      }
    };
    walk(tree, 0, undefined);
    return { text: lines.join("\n"), truncated };
  };

  /** YAML-like text in the shape of Playwright's aria snapshot. */
  P.serialize = (tree, maxChars) => {
    const whole = render(tree, maxChars, Infinity);
    if (!whole.truncated) return whole;
    return render(tree, maxChars, Math.min(CHROME_CHARS, Math.floor(maxChars / 8)));
  };

  P.sweep = () => {
    for (const [ref, record] of S.refs) if (!record.el.isConnected) S.refs.delete(ref);
  };

  P.dialogs = () => {
    const names = [];
    for (const el of document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]')) {
      if (!P.hidden(el)) names.push(P.clip(P.name(el, "dialog") || P.name(el.querySelector("h1,h2,h3,[role=heading]") || el, "heading") || "dialog", 80));
      if (names.length >= 5) break;
    }
    return names;
  };

  P.focused = () => {
    let el = document.activeElement;
    for (let depth = 0; el && /^(IFRAME|FRAME)$/.test(el.tagName) && depth < 8; depth++) {
      let inner = null;
      try { inner = el.contentDocument?.activeElement; } catch { inner = null; }
      if (!inner) break;
      el = inner;
    }
    if (!el || el === document.body || el === document.documentElement) return "";
    const ref = S.ids.get(el);
    return P.describe(el) + (ref && S.refs.has(ref) ? ` [ref=${ref}]` : "");
  };

  P.snapshot = (args) => {
    if (!S.documentId) S.documentId = args.candidateId;
    // A cross-origin frame numbers its refs from its own range, so one snapshot never
    // names two controls alike (frames.rs routes a ref to its frame by that range).
    if (args.refBase && S.next < args.refBase) S.next = args.refBase;
    if (args.readSemantic) {
      S.readSemantic = args.readSemantic;
      try { S.semantic = JSON.stringify(args.readSemantic()); } catch { S.semantic = null; }
    }
    let root = document;
    if (args.scopeRef) {
      const resolved = P.resolve(S.documentId, args.scopeRef);
      if (!resolved.ok) return resolved;
      root = resolved.el;
    }
    P.sweep();
    const built = P.build(root, { maxRefs: args.maxRefs });
    if (root === document) {
      // Hidden file inputs sit behind a site's own upload button.
      const files = [];
      for (const input of document.querySelectorAll('input[type=file]')) {
        if (S.ids.has(input) && S.refs.has(S.ids.get(input))) continue;
        if (input.disabled || files.length >= 10) continue;
        files.push({ role: "button", name: P.name(input), ref: P.register(input), props: ["file input"], children: [] });
      }
      if (files.length) built.tree.children.push({ role: "group", name: "File inputs behind upload buttons", props: [], children: files });
    }
    const out = P.serialize(built.tree, args.maxChars ?? 24000);
    // A popup over the page leads the snapshot, with its close control, so the agent closes it
    // before it reads or acts: as text, a covered page read like any other (page_read.js).
    let popup = null;
    try {
      popup = root === document && P.coveringPopup ? P.coveringPopup() : null;
      // An empty backdrop has nothing to close; hidden, it stops catching clicks (page_read.js).
      for (let tries = 0; popup?.empty && tries < 3; tries++) { P.hideCover(popup.box); popup = P.coveringPopup(); }
      if (popup?.empty) popup = null;
    } catch { popup = null; }
    const cover = popup
      ? `- note: A popup covers this page ("${popup.name}"). Close it first: ${popup.close ? `click ref=${P.register(popup.close)}` : "press Escape (browser_steps key Escape)"}.\n`
      : "";
    // An error page reads like any other, and a run that guessed an address took one as the
    // site's answer ("We Can't Find That Page", Odysseys, October 20): say what it is.
    let missing = "";
    try {
      const heading = document.querySelector("h1")?.innerText ?? "";
      const said = `${document.title || ""} ${heading}`;
      if (root === document && (document.body?.innerText ?? "").length < 6000 &&
        /\b404\b|page not found|not found|can.?t (find|locate) (that|this|the) page|page (doesn.?t|does not|no longer) exist|no longer available/i.test(said))
        missing = `- note: This is an error page ("${P.clip(said, 80)}"): the address is wrong or gone. Find the page through the site's own search or links, or a web search, instead of guessing another address.\n`;
    } catch { missing = ""; }
    return {
      ok: true, documentId: S.documentId, url: location.href, title: document.title || "",
      tree: missing + cover + (out.text || "- text: (the page shows no readable content)"),
      truncated: out.truncated || built.scanLimited || built.refLimited,
      refCount: built.interactive.length, dialogs: P.dialogs(), focused: P.focused(),
      // Pattern and app skills that apply to this page (page_skills.js).
      ...(root === document && P.detectSkills ? { skills: P.detectSkills() } : {}),
      scroll: { y: Math.round(scrollY), height: Math.round(document.documentElement.scrollHeight), viewport: Math.round(innerHeight) },
    };
  };

  /** Ranks the page's actionable elements against a plain-language description. */
  P.find = (args) => {
    if (!S.documentId) S.documentId = args.candidateId;
    P.sweep();
    const built = P.build(document, { maxRefs: 2000 });
    const words = String(args.query || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
    const phrase = String(args.query || "").toLowerCase().trim();
    const roleWords = { button: ["button", "clickable"], link: ["link"], field: ["textbox", "searchbox", "combobox", "spinbutton"],
      box: ["textbox", "searchbox", "checkbox", "combobox"], input: ["textbox", "searchbox", "combobox", "spinbutton"],
      checkbox: ["checkbox", "switch"], tab: ["tab"], menu: ["menuitem", "menu"], dropdown: ["combobox", "listbox"], option: ["option"],
      toggle: ["switch", "checkbox", "button", "clickable", "radio"], switch: ["switch", "checkbox", "clickable"] };
    // Words that name the thing, not its kind: a match should contain most of them.
    const content = words.filter((word) => !roleWords[word]);
    const scored = built.interactive.map((node) => {
      const haystack = `${node.role} ${node.name} ${node.value ?? ""} ${node.url ?? ""}`.toLowerCase();
      let score = 0;
      let named = 0;
      for (const word of words) {
        if (haystack.includes(word)) score += 2;
        if (haystack.includes(word) && !roleWords[word]) named++;
        if (roleWords[word]?.includes(node.role)) score += 3;
      }
      if (phrase && node.name.toLowerCase() === phrase) score += 8;
      else if (phrase.length > 3 && haystack.includes(phrase)) score += 4;
      return { node, score, named };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(20, args.limit ?? 8));
    const strong = scored.some((item) => content.length === 0 || item.named * 2 >= content.length);
    // A weak search says so, so the agent reads the page rather than acting on a poor guess.
    const hint = strong ? undefined : "No element matched most of these words; these are loose guesses. Read the page with browser_snapshot (use scopeRef for one region) instead of searching again.";
    // What was found comes into view, as a person scrolls to what they look for: the page on
    // screen shows the evidence, which is what a tab kept as proof needs.
    const shown = strong && scored[0]?.node.ref ? P.reveal(S.refs.get(scored[0].node.ref)?.el) && P.line(scored[0].node) : P.revealText(phrase);
    return { ok: true, documentId: S.documentId, url: location.href, matches: scored.map((item) => P.line(item.node)), ...(shown ? { scrolledTo: shown } : {}), ...(hint ? { weak: true, hint } : {}) };
  };

  /** Scrolls an element to the middle of the view; whether it could. */
  P.reveal = (el) => {
    if (!el?.isConnected) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); return true; } catch { return false; }
  };

  /** Scrolls to the first visible text containing `phrase`, and returns that text, or "". */
  P.revealText = (phrase) => {
    if (!phrase || phrase.length < 3) return "";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(), seen = 0; node && seen < 20000; node = walker.nextNode(), seen++) {
      const text = node.data;
      if (!text.toLowerCase().includes(phrase) || !node.parentElement || P.hidden(node.parentElement)) continue;
      return P.reveal(node.parentElement) ? P.clip(text.replace(/\s+/g, " ").trim(), 120) : "";
    }
    return "";
  };

  /** Readable Markdown of the page for a model to extract from. */
  P.markdown = (args) => {
    const built = P.build(document, { maxRefs: 0 });
    const out = [];
    let chars = 0;
    const max = args.maxChars ?? 120000;
    let truncated = false;
    const push = (text) => {
      if (truncated || !text) return;
      if (chars + text.length > max) { truncated = true; return; }
      out.push(text);
      chars += text.length + 1;
    };
    const inline = (node) => node.text !== undefined ? node.text
      : node.role === "link" && node.url ? `[${node.name || node.url}](${node.url})` : node.name || node.children.map(inline).join(" ");
    const walk = (node, indent) => {
      for (const child of node.children) {
        if (child.text !== undefined) { push(indent + child.text); continue; }
        switch (child.role) {
          case "heading": push(`\n${"#".repeat(Math.min(6, Number((child.props.find((p) => p.startsWith("level=")) || "level=2").slice(6)) || 2))} ${child.name}`); break;
          case "link": push(`${indent}[${child.name || child.url}](${child.url})`); break;
          case "img": if (child.name) push(`${indent}![${child.name}]`); break;
          case "listitem": push(`${indent}- ${child.children.map(inline).join(" ").trim()}`); break;
          case "row": push(`| ${child.children.map((cell) => inline(cell).replace(/\|/g, "\\|")).join(" | ")} |`); break;
          case "textbox": case "searchbox": case "combobox": case "button": case "clickable": case "option": break;
          default: walk(child, child.role === "list" ? indent + "  " : indent);
        }
      }
    };
    walk(built.tree, "");
    return { ok: true, url: location.href, title: document.title || "", markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), truncated };
  };
})(globalThis.__mistyAgentPageV1 ??= {});
