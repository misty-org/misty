// Misty agent page runtime, part 2 of 4: the accessibility tree, its text
// snapshot with refs, element search and Markdown for extraction.
((P) => {
  const S = P.state;
  const MAX_SCAN = 25000;
  const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  // Roles that become a line of their own even without a ref.
  const STRUCTURE = new Set(["navigation", "main", "complementary", "form", "dialog", "alertdialog", "alert", "region",
    "article", "banner", "contentinfo", "search", "group", "radiogroup", "toolbar", "menu", "menubar", "tablist",
    "tabpanel", "tree", "grid", "treegrid", "table", "row", "cell", "rowheader", "list", "listitem", "heading", "img",
    "status", "progressbar", "meter", "iframe"]);
  // Interactive roles whose name already says everything inside them.
  const LEAF = new Set(["button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "spinbutton", "slider",
    "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "heading", "img", "clickable", "columnheader"]);
  // Cursors a page sets on what it means to be dragged, resized, zoomed or clicked (after
  // page-agent's dom_tree, MIT; see NOTICE). Only where the cursor starts counts: a card's
  // children inherit its pointer, and listing each of them would repeat the card.
  const INTERACTIVE_CURSORS = new Set(["pointer", "move", "grab", "grabbing", "cell", "zoom-in", "zoom-out",
    "col-resize", "row-resize", "ew-resize", "ns-resize", "all-scroll", "crosshair", "context-menu"]);
  // What a control inside a link, a button or a clickable card must be to get a ref of its own
  // there: a "favourite" button inside a product link, a row's checkbox, a card's "⋯" menu.
  const DISTINCT_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const DISTINCT_ROLES = new Set(["button", "checkbox", "radio", "switch", "menuitem", "menuitemcheckbox",
    "menuitemradio", "tab", "combobox", "textbox", "searchbox", "spinbutton", "slider"]);
  const OWN_STATE = ["aria-haspopup", "aria-expanded", "aria-checked", "aria-pressed"];
  const cursorCache = new WeakMap();
  const cursorOf = (el) => {
    if (!cursorCache.has(el)) cursorCache.set(el, el.ownerDocument.defaultView.getComputedStyle(el).cursor);
    return cursorCache.get(el);
  };

  const states = (el, role, node) => {
    const aria = (name) => el.getAttribute(name);
    const props = node.props;
    const pw = (read, fallback) => {
      if (!P.aria) return fallback();
      try { return read(P.aria); } catch { return fallback(); }
    };
    if (role === "heading") props.push(`level=${pw((a) => a.level(el), () => Number(aria("aria-level") || el.tagName.slice(1) || 2))}`);
    if (["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"].includes(role)) {
      const checked = pw((a) => String(a.checked(el)), () => el.tagName === "INPUT" ? (el.indeterminate ? "mixed" : String(el.checked)) : aria("aria-checked"));
      props.push(checked === "true" ? "checked" : checked === "mixed" ? "mixed" : "unchecked");
    }
    const pressed = pw((a) => a.pressed(el), () => aria("aria-pressed") === "true");
    if (pressed === true) props.push("pressed");
    if (pressed === "mixed") props.push("pressed=mixed");
    const expanded = pw((a) => a.expanded(el), () => aria("aria-expanded") ? aria("aria-expanded") === "true" : undefined);
    if (expanded !== undefined) props.push(expanded ? "expanded" : "collapsed");
    if (pw((a) => a.selected(el), () => aria("aria-selected") === "true") || (el.tagName === "OPTION" && el.selected)) props.push("selected");
    if (aria("aria-current") && aria("aria-current") !== "false") props.push("current");
    if (pw((a) => a.disabled(el), () => el.disabled || aria("aria-disabled") === "true")) props.push("disabled");
    if (el.required || aria("aria-required") === "true") props.push("required");
    if (aria("aria-invalid") === "true" || (el.validity && el.willValidate && !el.validity.valid && el.value)) props.push("invalid");
    if (el.readOnly || aria("aria-readonly") === "true") props.push("readonly");
    if (role === "textbox" && (el.tagName === "TEXTAREA" || aria("aria-multiline") === "true" || el.isContentEditable)) props.push("multiline");
    // What a name can't say (after page-agent's attribute list, MIT; see NOTICE): the kind of value
    // a field takes, a hint that isn't its name, a date format, the popup a control opens, a link
    // that opens a new tab, and a component's own open/closed state where ARIA says none.
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["date", "time", "datetime-local", "month", "week", "number", "email", "tel", "url", "color"].includes(type)) props.push(`type=${type}`);
    }
    const hint = el.getAttribute("placeholder");
    if (hint && hint.trim() && hint.trim() !== node.name) props.push(`hint=${quote(P.clip(hint.trim(), 60))}`);
    const format = el.getAttribute("data-date-format") || (el.tagName === "INPUT" && el.getAttribute("pattern"));
    if (format) props.push(`format=${quote(P.clip(format, 40))}`);
    const popup = aria("aria-haspopup");
    if (popup && popup !== "false" && role !== "combobox") props.push(`popup=${popup === "true" ? "menu" : popup}`);
    if (role === "link" && el.closest("a[target=_blank], area[target=_blank]")) props.push("new tab");
    const state = el.getAttribute("data-state");
    if (state && /^(open|closed|on|off|checked|unchecked|active|inactive)$/.test(state) &&
      !aria("aria-expanded") && !aria("aria-checked") && !aria("aria-pressed") && !aria("aria-selected")) props.push(`state=${state}`);
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

  /**
   * How far a block can still scroll, or null when it doesn't (after page-agent's dom_tree, MIT;
   * see NOTICE). A box scrolls when its overflow says so, or when it sets its scrollbar's width or
   * gutter, which only boxes made to scroll do (some only turn overflow on under the pointer).
   * Less than 4px of room is no room.
   */
  const scrollRoom = (el, style) => {
    const signal = (style.scrollbarWidth && style.scrollbarWidth !== "auto") ||
      (style.scrollbarGutter && style.scrollbarGutter !== "auto");
    const y = /(auto|scroll|overlay)/.test(style.overflowY) || signal;
    const x = /(auto|scroll|overlay)/.test(style.overflowX) || signal;
    const height = el.scrollHeight - el.clientHeight;
    const width = el.scrollWidth - el.clientWidth;
    const roomY = y && height >= 4;
    const roomX = x && width >= 4;
    if (!roomY && !roomX) return null;
    const parts = [];
    const px = (value) => `${Math.round(value)}px`;
    if (roomY) {
      const below = height - el.scrollTop;
      if (below >= 4) parts.push(`${px(below)} below`);
      if (el.scrollTop >= 4) parts.push(`${px(el.scrollTop)} above`);
    }
    if (roomX) {
      const right = width - el.scrollLeft;
      if (right >= 4) parts.push(`${px(right)} right`);
      if (el.scrollLeft >= 4) parts.push(`${px(el.scrollLeft)} left`);
    }
    return { text: parts.join(", ") };
  };

  /** Whether a control inside a named leaf acts on its own, apart from the leaf. */
  const distinct = (el) => {
    if (DISTINCT_TAGS.has(el.tagName)) return !(el.tagName === "INPUT" && el.type === "hidden");
    const role = el.getAttribute("role");
    if (role && DISTINCT_ROLES.has(role)) return true;
    if (el.isContentEditable && el.getAttribute("contenteditable") !== null) return true;
    if (OWN_STATE.some((name) => el.hasAttribute(name) && el.getAttribute(name) !== "false")) return true;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return !style.display.startsWith("inline") && scrollRoom(el, style) !== null;
  };

  const DROP_ROLES = new Set(["region", "group", "listitem", "row", "cell", "article", "tabpanel", "form", "dialog", "figure", "list", "complementary"]);

  /** Builds the visible accessibility tree under root, registering refs. */
  P.build = (root, limits = {}) => {
    P.aria?.begin?.();
    try {
      return buildTree(root, limits);
    } finally {
      P.aria?.end?.();
    }
  };

  const buildTree = (root, limits = {}) => {
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
    /** Under a named leaf: lists the controls inside it that act on their own, nothing else. */
    const visitDistinct = (el, parent) => {
      const kids = el.shadowRoot ? el.shadowRoot.childNodes
        : el.tagName === "SLOT" ? el.assignedNodes({ flatten: true }) : el.childNodes;
      for (const child of kids) {
        if (scanLimited) return;
        if (child.nodeType !== 1) continue;
        if (++scanned > MAX_SCAN) { scanLimited = true; return; }
        if (P.hiddenSelf(child)) continue;
        if (distinct(child)) visit(child, parent);
        else visitDistinct(child, parent);
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
        const cursor = cursorOf(el);
        const pointer = INTERACTIVE_CURSORS.has(cursor) && (!parentEl || cursorOf(parentEl) !== cursor);
        // A toggle that names the popup it opens is clickable whatever its cursor (Bootstrap's
        // dropdowns, unroled menu buttons).
        const toggle = (el.hasAttribute("aria-haspopup") && el.getAttribute("aria-haspopup") !== "false") ||
          el.getAttribute("data-toggle") === "dropdown";
        clickable = tabbable || toggle || pointer ||
          el.hasAttribute("onclick") || el.hasAttribute("onmousedown") || el.hasAttribute("onmouseup");
        if (clickable) role = "clickable";
      }
      const draggable = !invisible && el.getAttribute("draggable") === "true";
      if (draggable && !role) role = "clickable";
      const scroll = block && el !== el.ownerDocument.body && el !== el.ownerDocument.documentElement
        ? scrollRoom(el, style) : null;
      const scrollable = Boolean(scroll);
      const named = DROP_ROLES.has(role) && !invisible && P.name(el, role) !== "";
      const acts = !invisible && (P.interactiveRoles.has(role) || clickable || draggable || named);
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
      if (scroll) node.props.push(scroll.text ? `scrollable: ${scroll.text}` : "scrollable");
      if (draggable) node.props.push("draggable");
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
      } else if (!invisible) {
        // The name says what the control is; only controls of their own inside it are listed.
        visitDistinct(el, node);
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
  // box and filters the agent came for. When a page doesn't fit,
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

  /**
   * Where the window is on the page, in pixels and in window heights above and below it (after
   * page-agent's page info, MIT; see NOTICE), for a read that shows only part of the page.
   */
  P.pagePosition = () => {
    const root = document.scrollingElement || document.documentElement;
    const viewport = Math.max(1, innerHeight);
    const below = Math.max(0, root.scrollHeight - (scrollY + innerHeight));
    return {
      y: Math.round(scrollY), x: Math.round(scrollX), height: Math.round(root.scrollHeight), width: Math.round(root.scrollWidth),
      viewport: Math.round(innerHeight), pagesAbove: Math.round((scrollY / viewport) * 10) / 10, pagesBelow: Math.round((below / viewport) * 10) / 10,
    };
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
    // What this read showed, so a compact read later marks only the controls that are new
    // (page_effects.js); a scoped read adds to the last one.
    P.markSeen?.(out.text, !!args.scopeRef);
    const signIn = root === document && P.signInNote ? P.signInNote() : "";
    return {
      ok: true, documentId: S.documentId, url: location.href, title: document.title || "",
      tree: missing + cover + signIn + (out.text || "- text: (the page shows no readable content)"),
      truncated: out.truncated || built.scanLimited || built.refLimited,
      refCount: built.interactive.length, dialogs: P.dialogs(), focused: P.focused(),
      // Pattern and app skills that apply to this page (page_skills.js).
      ...(root === document && P.detectSkills ? { skills: P.detectSkills() } : {}),
      scroll: P.pagePosition(),
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

  /** What a page keeps in collapsed sections: a closed <details>, or an accordion panel whose
   * toggle says it is collapsed. Hidden, it never reaches the page's text, and a run read "the
   * page does not mention salary reviews" off a page whose closed benefits panel said so
   * (Odysseys, October 29). Menus, navigation and dialogs are not content and stay out. */
  P.collapsedText = (limit = 8000) => {
    const out = [];
    const seen = new Set();
    let chars = 0;
    const chrome = "nav,header,footer,[role=navigation],[role=menu],[role=menubar],[role=dialog],[role=listbox],[role=tooltip]";
    const add = (label, text, el) => {
      if (!el || seen.has(el) || chars >= limit || el.closest(chrome)) return;
      seen.add(el);
      const flat = (text || "").replace(/\s+/g, " ").trim();
      if (flat.length < 20) return;
      const line = `- ${label ? `${P.clip(label.replace(/\s+/g, " ").trim(), 80)}: ` : ""}${P.clip(flat, 1500)}`;
      chars += line.length + 1;
      out.push(line);
    };
    for (const details of document.querySelectorAll("details:not([open])")) {
      const summary = details.querySelector(":scope > summary");
      const body = [...details.childNodes].filter((node) => node !== summary).map((node) => node.textContent || "").join(" ");
      add(summary?.textContent || "", body, details);
    }
    for (const toggle of document.querySelectorAll('[aria-expanded="false"]')) {
      if (toggle.closest(chrome)) continue;
      const ids = (toggle.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean);
      const panels = ids.length ? ids.map((id) => document.getElementById(id))
        : [toggle.nextElementSibling, toggle.parentElement?.nextElementSibling];
      const panel = panels.find((el) => el && P.hidden(el) && !el.contains(toggle));
      if (panel) add(P.name(toggle), panel.textContent, panel);
    }
    return out.length ? out.join("\n") : "";
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
    let collapsed = "";
    try { collapsed = P.collapsedText(); } catch { collapsed = ""; }
    return { ok: true, url: location.href, title: document.title || "", markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), truncated, collapsed };
  };
})(globalThis.__mistyAgentPageV1 ??= {});
