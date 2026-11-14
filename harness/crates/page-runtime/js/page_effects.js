// Misty agent page runtime, part 6: what a step did to the page, a compact read of the page
// between steps with new refs marked, and whether the page asks the person to sign in.
//
// The effect probe and the compact state follow browser-use's `browser_use/ax.py` (PROBE_JS and
// its state format; MIT, Copyright (c) 2024 Gregor Zunic; see NOTICE): a token per document, and
// a count of the page's own reactions that ignores writes of an attribute's current value, counts
// a style change only once per element in 200 ms, and counts form input and change events, in this
// document and its same-origin frames. Written for this runtime, which reads the page from its own
// script world instead of through the DevTools protocol.
((P) => {
  const S = P.state;
  if (S.tokenDocument !== document) {
    S.tokenDocument = document;
    // A step that ends in another document navigated; a new world starts with a new token.
    S.docToken = Math.random().toString(36).slice(2, 12);
    // Refs shown in the last read of this document, so the next read can mark the new ones.
    S.seen = null;
    S.watch = null;
    S.effect = null;
  }

  // Misty's own overlays (the agent cursor, its control and the ring around the page) and the
  // network counter's mark (page_network.js) are not the page reacting.
  const BUSY = "data-misty-busy";
  const own = (node) => node?.nodeType === 1 && (/^MISTY-AGENT-/.test(node.tagName) || node.id === "misty-agent-ring");

  /**
   * Whether a batch of mutation records is the page reacting. `styled` remembers, per element,
   * when its style last changed: an animation that rewrites a style every frame counts once, a
   * menu shown by `style.display` counts.
   */
  P.realMutations = (records, styled) => {
    const now = performance.now();
    let real = false;
    for (const record of records) {
      if (own(record.target) || [...record.addedNodes].some(own) || [...record.removedNodes].some(own)) continue;
      if (record.type === "attributes") {
        if (record.attributeName === BUSY) continue;
        // Writing an attribute's current value changes nothing (some apps rewrite a class every frame).
        if (record.oldValue === record.target.getAttributeNS(record.attributeNamespace, record.attributeName)) continue;
        if (record.attributeName === "style") {
          const last = styled.get(record.target) ?? -1e9;
          styled.set(record.target, now);
          if (now - last <= 200) continue;
        }
      }
      real = true;
    }
    return real;
  };

  /** Starts counting the page's reactions, once per document and same-origin frame. */
  const watch = () => {
    S.watch ??= { count: 0, last: performance.now(), docs: new WeakSet() };
    const W = S.watch;
    const bump = () => { W.count++; W.last = performance.now(); };
    const observe = (win, depth) => {
      let doc;
      try { doc = win.document; } catch { return; } // another origin
      if (!doc || depth > 8) return;
      if (!W.docs.has(doc)) {
        W.docs.add(doc);
        const styled = new WeakMap();
        new win.MutationObserver((records) => { if (P.realMutations(records, styled)) bump(); })
          .observe(doc, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
        for (const type of ["input", "change"]) win.addEventListener(type, bump, true);
      }
      for (let index = 0; index < win.frames.length; index++) observe(win.frames[index], depth + 1);
    };
    observe(window, 0);
    return W;
  };
  P.watchPage = watch;

  const field = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
  const valueNow = (el) => {
    if (!el?.isConnected || P.secret(el)) return undefined;
    if (field(el)) {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio") return undefined;
      return el.tagName === "SELECT" ? Array.from(el.selectedOptions).map((option) => option.text.trim()).join(", ") : el.value;
    }
    return el.isContentEditable ? (el.innerText ?? el.textContent ?? "") : undefined;
  };
  const checkedNow = (el) => {
    if (!el?.isConnected) return undefined;
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) return el.checked;
    const aria = el.getAttribute("aria-checked") ?? el.getAttribute("aria-pressed") ?? el.getAttribute("aria-expanded");
    return aria === null ? undefined : aria;
  };

  /** Before a step: remembers the page so `effectEnd` can say what the step did. */
  P.effectStart = (args) => {
    const W = watch();
    const target = args.ref ? S.refs.get(args.ref)?.el : null;
    S.effect = { token: S.docToken, at: performance.now(), url: location.href, count: W.count, focus: P.focused(), target, value: valueNow(target), checked: checkedNow(target) };
    return { ok: true, token: S.docToken };
  };

  /**
   * After a step and its settle: what changed. `navigated` when the step ended in another
   * document or at another address, `page changed` when the page reacted (DOM, focus, the
   * control's value or state), `no change` when nothing did, which usually means the click
   * missed or the page ignored it.
   */
  P.effectEnd = (args) => {
    const before = S.effect;
    if (!before || String(args.token || "") !== S.docToken) return { ok: true, effect: "navigated", url: location.href, newDocument: true };
    S.effect = null;
    const W = watch();
    if (location.href !== before.url) return { ok: true, effect: "navigated", url: location.href };
    const out = { ok: true, effect: "no change", url: location.href };
    const mutations = W.count - before.count;
    if (mutations > 0) out.mutations = mutations;
    const focus = P.focused();
    if (focus !== before.focus) out.focus = focus || "(nothing)";
    const value = valueNow(before.target);
    if (value !== before.value && value !== undefined) out.valueNow = P.clip(value, 200);
    const checked = checkedNow(before.target);
    if (checked !== before.checked && checked !== undefined) out.checkedNow = checked;
    if (mutations > 0 || out.focus !== undefined || out.valueNow !== undefined || out.checkedNow !== undefined) out.effect = "page changed";
    return out;
  };

  /** Records the refs a read showed, so the next read can mark the ones that are new. */
  P.markSeen = (text, add = false) => {
    const refs = Array.from(String(text).matchAll(/\[ref=(e\d+)\]/g), (match) => match[1]);
    S.seen = new Set([...(add && S.seen ? S.seen : []), ...refs]);
  };

  const SIGN_IN_PLACES = [
    [/(^|\.)accounts\.google\.com$/], [/(^|\.)login\.microsoftonline\.com$/], [/(^|\.)login\.live\.com$/],
    [/(^|\.)(appleid|idmsa)\.apple\.com$/], [/(^|\.)signin\.aws\.amazon\.com$/], [/(^|\.)okta\.com$/], [/(^|\.)auth0\.com$/],
    [/(^|\.)login\.yahoo\.com$/], [/(^|\.)id\.atlassian\.com$/], [/(^|\.)amazon\.[a-z.]+$/, /^\/ap\/(signin|mfa|cvf)/],
    [/(^|\.)github\.com$/, /^\/(login|session)\b/], [/(^|\.)linkedin\.com$/, /^\/(login|uas\/login|checkpoint)/],
  ];
  const SIGN_IN_PATH = /\/(sign[-_]?in|log[-_]?in|signon|sso|session\/new|users\/sign_in|oauth2?\/authorize|auth\/(login|signin))\b/i;
  const USER_FIELD = /^(user(name)?|login|email|e-mail|identifier|account|loginfmt)$/i;

  /**
   * Whether the page asks someone to sign in: a password or one-time code field, or, on a known
   * sign-in address, the email-first step (Google, Microsoft, Apple and Amazon ask for the email
   * on one page and the password on the next). The person's saved sessions did not cover it.
   */
  P.signIn = () => {
    const shown = [...document.querySelectorAll("input")].filter((el) => !el.disabled && !P.hidden(el));
    const secret = shown.map((el) => P.secret(el)).find((kind) => kind === "password" || kind === "one-time code");
    const users = shown.filter((el) => {
      const auto = (el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/).pop();
      return auto === "username" || auto === "email" || el.type === "email" || USER_FIELD.test(el.name || el.id || "");
    });
    const host = location.hostname;
    const place = SIGN_IN_PLACES.some(([hostPattern, pathPattern]) => hostPattern.test(host) && (!pathPattern || pathPattern.test(location.pathname)));
    const path = SIGN_IN_PATH.test(location.pathname);
    let kind = "";
    if (secret) kind = secret;
    else if (users.length === 1 && (place || path)) kind = "email or username first";
    else if (place) kind = "sign-in page";
    return { ok: true, signIn: kind ? { kind, host } : null };
  };

  /** A line for the top of a read when the page asks someone to sign in. */
  P.signInNote = () => {
    let found = null;
    try { found = P.signIn().signIn; } catch { found = null; }
    if (!found) return "";
    return `- note: This page asks someone to sign in (${found.kind}, ${found.host}). The person's saved session does not cover it. Never type a password or code: ask the person with browser_request_user_action, or say the site needs them to sign in.\n`;
  };

  /**
   * The page as a compact state between steps: a short header, then the tree within `maxChars`
   * (4,000 by default), keeping its first 80% and last 20% when it is longer, with `*` before
   * every control that is new since the last read of this document.
   */
  P.compact = (args) => {
    if (!S.documentId) S.documentId = args.candidateId;
    P.sweep();
    const max = Math.max(1000, Math.min(24000, Number(args.maxChars) || 4000));
    const built = P.build(document, { maxRefs: args.maxRefs ?? 800 });
    // Read the whole page (up to a large cap), then keep its start and end within `max`.
    const whole = P.serialize(built.tree, 200000);
    const before = S.seen;
    const marked = (whole.text ? whole.text.split("\n") : []).map((line) => {
      const ref = line.match(/\[ref=(e\d+)\]/)?.[1];
      return { line: ref && before && !before.has(ref) ? line.replace(/^(\s*)- /, "$1*- ") : line, ref };
    });
    let kept = marked;
    let omitted = null;
    const total = marked.reduce((sum, item) => sum + item.line.length + 1, 0);
    if (total > max) {
      const head = [];
      const tail = [];
      let used = 0;
      for (const item of marked) {
        if (used + item.line.length + 1 > max * 0.8) break;
        head.push(item);
        used += item.line.length + 1;
      }
      used = 0;
      for (let index = marked.length - 1; index >= head.length; index--) {
        const item = marked[index];
        if (used + item.line.length + 1 > max * 0.2) break;
        tail.unshift(item);
        used += item.line.length + 1;
      }
      const middle = marked.slice(head.length, marked.length - tail.length);
      const fresh = middle.filter((item) => item.line.trimStart().startsWith("*")).length;
      omitted = { lines: middle.length, fresh };
      kept = [...head, { line: `- text: (${middle.length} lines in the middle left out${fresh ? `, ${fresh} of them new controls` : ""}; browser_snapshot reads the whole page, browser_find searches it)` }, ...tail];
    }
    const body = kept.map((item) => item.line).join("\n");
    P.markSeen(body, false);
    const header = [];
    if (document.readyState !== "complete") header.push(`- note: The page is still loading (${document.readyState}).`);
    const dialogs = P.dialogs();
    if (dialogs.length) header.push(`- note: Open dialog: ${dialogs.map((name) => `"${name}"`).join(", ")}.`);
    let cover = "";
    try {
      const popup = P.coveringPopup?.();
      if (popup && !popup.empty) cover = `- note: A popup covers this page ("${popup.name}"). Close it first: ${popup.close ? `click ref=${P.register(popup.close)}` : "press Escape (browser_steps key Escape)"}.`;
    } catch { cover = ""; }
    if (cover) header.push(cover);
    const signIn = P.signInNote().trimEnd();
    if (signIn) header.push(signIn);
    if (before) header.push("- note: Lines starting with * are controls that are new since your last read of this page.");
    return {
      ok: true, compact: true, documentId: S.documentId, url: location.href, title: document.title || "",
      tree: [...header, body || "- text: (the page shows no readable content)"].join("\n"),
      truncated: !!omitted || whole.truncated || built.scanLimited || built.refLimited,
      ...(omitted ? { omitted } : {}),
      newRefs: before ? marked.filter((item) => item.ref && !before.has(item.ref)).length : 0,
      refCount: built.interactive.length, focused: P.focused(),
      scroll: { y: Math.round(scrollY), height: Math.round(document.documentElement.scrollHeight), viewport: Math.round(innerHeight) },
    };
  };
})(globalThis.__mistyAgentPageV1 ??= {});
