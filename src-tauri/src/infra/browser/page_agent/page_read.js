// Misty agent page runtime, part 4 of 4: what changed after an action, waiting
// for the page, and the single entry point Rust calls.
((P) => {
  const S = P.state;

  /** A short account of the page after an action, instead of a full snapshot. */
  P.observe = () => ({
    ok: true, documentId: S.documentId, url: location.href, title: document.title || "",
    dialogs: P.dialogs(), focused: P.focused(),
    alerts: Array.from(document.querySelectorAll('[role=alert],[role=status],[aria-live=assertive]'))
      .filter((el) => !P.hidden(el)).map((el) => P.clip(el.innerText ?? el.textContent, 160)).filter(Boolean).slice(0, 3),
  });

  /** Marks this document before a navigation, so Rust can tell a new page from this one. */
  P.mark = (args) => { S.navMark = { document, token: String(args.token || "") }; return { ok: true }; };

  // A site's bot check, which a normal browser passes by waiting a few seconds. Never solved.
  const CHALLENGE = /performing security verification|checking your browser|checking if the site connection is secure|verify(ing)? you are (a )?human|press (&|and) hold/;

  /** Whether a wait condition holds now. Rust polls this; it makes no model calls. */
  P.waitCheck = (args) => {
    const body = (document.body?.innerText ?? document.body?.textContent ?? "").toLowerCase();
    const checks = [];
    if (args.text) checks.push(body.includes(String(args.text).toLowerCase()));
    if (args.textGone) checks.push(!body.includes(String(args.textGone).toLowerCase()));
    if (args.urlIncludes) checks.push(location.href.includes(String(args.urlIncludes)));
    return {
      ok: true, met: checks.length > 0 && checks.every(Boolean), ready: document.readyState === "complete", url: location.href,
      mark: S.navMark?.document === document ? S.navMark.token : "",
      challenge: /^just a moment/i.test(document.title || "") || (body.length < 3000 && CHALLENGE.test(body)),
    };
  };

  /** Resolves once the DOM has been quiet for quietMs, or after maxMs. */
  P.settle = (args) => new Promise((resolve) => {
    const quiet = Math.max(50, Math.min(1000, args.quietMs ?? 200));
    const max = Math.max(quiet, Math.min(5000, args.maxMs ?? 1500));
    let timer = 0;
    const started = Date.now();
    const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve({ ok: true, waitedMs: Date.now() - started }); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    timer = setTimeout(done, quiet);
    const cap = setTimeout(done, max);
  });

  // Cookie and consent banners cover what an agent came to read and show. Its own tabs answer
  // them the most private way (reject, or necessary or essential only), never by accepting,
  // and only a control inside a banner about cookies or consent.
  const DECLINE = /^(reject|decline|deny|refuse)( all)?( cookies)?$|^(use |allow )?(only )?(strictly )?(necessary|essential|required)( cookies)?( only)?$|^only (necessary|essential|required)( cookies)?$|^reject (all )?(non-essential|optional|additional)( cookies)?$|^continue without (accepting|agreeing)$|^(don't|do not) accept$/i;
  const CONTROLS = 'button,[role=button],a[href="#"],a:not([href]),input[type=button],input[type=submit]';
  /** Controls in the document and in open shadow roots, where consent managers such as
   * Transcend draw their banners. */
  const allControls = () => {
    const found = [...document.querySelectorAll(CONTROLS)];
    const roots = [...document.querySelectorAll("*")].filter((el) => el.shadowRoot).map((el) => el.shadowRoot);
    for (let index = 0; index < roots.length && index < 50; index++) {
      found.push(...roots[index].querySelectorAll(CONTROLS));
      roots.push(...[...roots[index].querySelectorAll("*")].filter((el) => el.shadowRoot).map((el) => el.shadowRoot));
    }
    return found;
  };
  P.declineConsent = () => {
    for (const el of allControls()) {
      const label = P.clip(el.innerText || el.value || el.getAttribute("aria-label") || "", 60).replace(/[.!]+$/, "");
      if (!label || !DECLINE.test(label) || P.hidden(el)) continue;
      let about = false;
      // Up through the element's ancestors, leaving a shadow root through its host.
      const up = (node) => node.parentElement || node.parentNode?.host || null;
      for (let box = up(el), depth = 0; box && depth < 8 && !about; box = up(box), depth++) {
        const named = `${box.id || ""} ${typeof box.className === "string" ? box.className : ""} ${box.getAttribute("aria-label") || ""}`;
        about = /cookie|consent|privacy|gdpr|onetrust|didomi|cmp/i.test(named) || (depth >= 1 && /cookie|consent/i.test((box.textContent || "").slice(0, 2000)));
      }
      if (!about) continue;
      el.click();
      return { ok: true, declined: label };
    }
    // No private choice offered: close the banner with its own close control, still never
    // accepting. A banner that offers only "Accept" is hidden in the agent's own tab instead,
    // so it no longer covers the page, and nothing is agreed to.
    for (const el of allControls()) {
      const label = P.clip(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "", 60).replace(/[.!]+$/, "");
      if (!label || !CLOSE.test(label) || P.hidden(el) || !consentBanner(el)) continue;
      el.click();
      return { ok: true, declined: label };
    }
    for (const el of allControls()) {
      const label = P.clip(el.innerText || el.value || "", 60);
      if (!/accept|agree|allow|got it|^ok$|understand/i.test(label) || P.hidden(el)) continue;
      const banner = consentBanner(el, true);
      if (!banner) continue;
      banner.style.setProperty("display", "none", "important");
      // Its dimmed backdrop is often a separate element; left alone, it covers the page.
      for (let tries = 0, cover = P.coveringPopup(); cover?.empty && tries < 3; tries++, cover = P.coveringPopup()) P.hideCover(cover.box);
      return { ok: true, declined: "hid the cookie banner" };
    }
    return { ok: true, declined: "" };
  };
  const CLOSE = /^(close|dismiss|no,? thanks|not now|maybe later|skip|×|✕|x)( (banner|notice|dialog|cookie (banner|notice)))?$/i;

  // Popups a person closes before reading (docs/plans/agent-harness.md, Page layer): newsletter and
  // discount offers, app prompts, surveys, sign-up walls. The agent read pages as text and never
  // noticed them, so its proof tabs stayed covered. A popup is the box on top in the middle of the
  // view, fixed or a dialog, over a quarter of it or more. Its own close control closes it, never
  // one that signs up, subscribes, accepts or logs in.
  const NOT_CLOSE = /sign ?up|subscribe|join|register|log ?in|sign ?in|accept|agree|allow|claim|get |yes|continue(?! without)|submit|buy|shop/i;
  const closeLabel = (el) => P.clip(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "", 60).replace(/[.!]+$/, "").trim();
  P.coveringPopup = () => {
    if (typeof document.elementFromPoint !== "function") return null;
    const area = innerWidth * innerHeight;
    for (const [x, y] of [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
      let box = null;
      for (let el = document.elementFromPoint(innerWidth * x, innerHeight * y); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        const style = getComputedStyle(el);
        const modal = el.matches('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]');
        if (!modal && style.position !== "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height >= area * 0.25) box = el;
      }
      if (!box) continue;
      // A backdrop with nothing to read or press: left by a banner that closed, or a scrim.
      if (!(box.innerText || "").trim() && !box.querySelector(CONTROLS + ",input,select,textarea,img,video,iframe,canvas"))
        return { box, close: null, name: "", empty: true };
      let close = null;
      for (const el of box.querySelectorAll(CONTROLS + ",[aria-label],[class*=close i],[id*=close i]")) {
        const label = closeLabel(el);
        const named = `${typeof el.className === "string" ? el.className : ""} ${el.id || ""}`;
        if (P.hidden(el) || NOT_CLOSE.test(label)) continue;
        if (CLOSE.test(label) || /^(close|dismiss)\b/i.test(el.getAttribute("aria-label") || "") || (/close|dismiss/i.test(named) && label.length <= 3)) { close = el; break; }
      }
      const heading = box.querySelector("h1,h2,h3,[role=heading]");
      const name = P.clip((box.getAttribute("aria-label") || heading?.innerText || heading?.textContent || box.innerText || box.textContent || "").replace(/\s+/g, " ").trim(), 80);
      return { box, close, name };
    }
    return null;
  };
  /** Hides an empty cover in the agent's own tab: nothing on it can be read, pressed or agreed to. */
  P.hideCover = (box) => box.style.setProperty("display", "none", "important");
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escape = () => {
    const target = document.activeElement || document.body;
    for (const type of ["keydown", "keyup"]) target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
  };
  /** Whether a popup's box still covers the page after an attempt to close it. */
  const stillCovers = (box) => box.isConnected && !P.hidden(box) && P.coveringPopup()?.box === box;
  /**
   * Closes an uninvited popup covering the page, as a person would, and checks it went: its own
   * close control, then Escape, and if it still covers the agent's own tab, hidden there (nothing
   * on it was pressed or agreed to). A close control that does nothing left a run's every click
   * "covered" on one site (Odysseys, October 20).
   */
  P.dismissPopup = async () => {
    const popup = P.coveringPopup();
    if (!popup) return { ok: true, dismissed: "" };
    if (popup.empty) {
      P.hideCover(popup.box);
      return { ok: true, dismissed: "an empty overlay" };
    }
    if (popup.close) {
      popup.close.click();
      await pause(400);
      if (!stillCovers(popup.box)) return { ok: true, dismissed: `${closeLabel(popup.close) || "close"} (${popup.name})` };
    }
    escape();
    await pause(300);
    if (!stillCovers(popup.box)) return { ok: true, dismissed: `Escape (${popup.name})` };
    P.hideCover(popup.box);
    for (let tries = 0, cover = P.coveringPopup(); cover?.empty && tries < 3; tries++, cover = P.coveringPopup()) P.hideCover(cover.box);
    return { ok: true, dismissed: `hid it (${popup.name})` };
  };
  /** The cookie or consent banner holding a control, or with `pinned`, only one fixed or sticky
   * over the page (the box a person would see covering it). */
  const consentBanner = (el, pinned = false) => {
    const up = (node) => node.parentElement || node.parentNode?.host || null;
    let about = null;
    for (let box = up(el), depth = 0; box && depth < 10; box = up(box), depth++) {
      const named = `${box.id || ""} ${typeof box.className === "string" ? box.className : ""} ${box.getAttribute?.("aria-label") || ""}`;
      if (!about && (/cookie|consent|gdpr|onetrust|didomi|cmp/i.test(named) || /cookie|consent/i.test((box.textContent || "").slice(0, 2000))))
        about = box;
      if (about && (!pinned || /fixed|sticky/.test(getComputedStyle(box).position))) return box;
    }
    return null;
  };

  const operations = {
    snapshot: (args) => P.snapshot(args), find: (args) => P.find(args), markdown: (args) => P.markdown(args),
    prepare: (args) => P.prepare(args), perform: (args) => P.perform(args), observe: () => P.observe(),
    waitCheck: (args) => P.waitCheck(args), settle: (args) => P.settle(args), mark: (args) => P.mark(args),
    skill: (args) => P.skill(args), locate: (args) => P.locate(args), declineConsent: () => P.declineConsent(), dismissPopup: () => P.dismissPopup(),
    locatorFor: (args) => {
      const resolved = P.resolve(args.documentId, args.ref);
      return resolved.ok && resolved.el ? { ok: true, locator: P.locatorOf(resolved.el) } : resolved;
    },
  };
  P.call = (operation, args) => {
    try {
      const run = operations[operation];
      if (!run) return { ok: false, attempted: false, error: "Unknown page operation." };
      return run(args || {});
    } catch (error) {
      // An exception during an action may follow a dispatched event, so only
      // read-only operations can say nothing was attempted.
      const message = String(error && error.message || error).slice(0, 500);
      return operation === "perform" || operation === "skill" ? { ok: false, error: message } : { ok: false, attempted: false, error: message };
    }
  };
})(globalThis.__mistyAgentPageV1 ??= {});
