// Misty agent page runtime, part 1 of 4: state, roles, names and refs.
//
// Runs in Misty's own WKContentWorld on macOS, so page scripts cannot see or
// patch it; the DOM is shared. Elsewhere it runs in the page world. Role and
// accessible-name rules follow WAI-ARIA and accname in simplified form, the
// way Playwright's aria snapshot does (Apache-2.0, design only; no code copied).
((P) => {
  P.state ??= { documentId: "", refs: new Map(), ids: new WeakMap(), next: 1, semantic: null, readSemantic: null, document: null };
  const S = P.state;
  if (S.document && S.document !== document) {
    // A document swap (rare in one world) invalidates every ref.
    S.documentId = ""; S.refs = new Map(); S.ids = new WeakMap(); S.next = 1; S.semantic = null;
  }
  S.document = document;

  const clip = (value, limit) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  };
  P.clip = clip;
  /** Like clip, for documents and tables: keeps line breaks, so rows and paragraphs survive. */
  P.clipText = (value, limit) => {
    const text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  };

  const implicitInputRole = (el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "checkbox") return el.getAttribute("role") === "switch" ? "switch" : "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "search") return el.hasAttribute("list") ? "combobox" : "searchbox";
    if (type === "hidden") return "";
    if (type === "file") return "button";
    if (["email", "tel", "text", "url", "password", ""].includes(type)) return el.hasAttribute("list") ? "combobox" : "textbox";
    return "textbox"; // date, time, color and the rest take typed values
  };

  P.role = (el) => {
    const explicit = (el.getAttribute("role") || "").trim().split(/\s+/)[0].toLowerCase();
    if (explicit && explicit !== "none" && explicit !== "presentation") return explicit;
    if (explicit === "none" || explicit === "presentation") return "";
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a": case "area": return el.hasAttribute("href") ? "link" : "";
      case "button": return "button";
      case "input": return implicitInputRole(el);
      case "textarea": return "textbox";
      case "select": return el.multiple || Number(el.getAttribute("size")) > 1 ? "listbox" : "combobox";
      case "option": return "option";
      case "img": return el.getAttribute("alt") === "" ? "" : "img";
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
      case "ul": case "ol": case "menu": return "list";
      case "li": return "listitem";
      case "nav": return "navigation";
      case "main": return "main";
      case "aside": return "complementary";
      case "form": return "form";
      case "table": return "table";
      case "tr": return "row";
      case "td": return "cell";
      case "th": return el.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
      case "dialog": return "dialog";
      case "fieldset": return "group";
      case "summary": return "button";
      case "progress": return "progressbar";
      case "meter": return "meter";
      case "iframe": case "frame": return "iframe";
      case "article": return "article";
      case "section": return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
      case "label": return "";
      default: return el.isContentEditable && el.getAttribute("contenteditable") !== null ? "textbox" : "";
    }
  };

  P.interactiveRoles = new Set(["link", "button", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox",
    "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "slider", "spinbutton", "treeitem", "gridcell", "columnheader"]);
  // Roles whose accessible name comes from their content.
  const nameFromContent = new Set(["button", "link", "checkbox", "radio", "switch", "option", "menuitem", "menuitemcheckbox",
    "menuitemradio", "tab", "heading", "cell", "gridcell", "columnheader", "rowheader", "treeitem", "tooltip", "row", "clickable"]);

  const textOf = (node, budget = 400) => {
    // innerText respects CSS; fall back to textContent where layout is absent.
    const value = node.innerText ?? node.textContent ?? "";
    return clip(value, budget);
  };

  const labelFor = (el) => {
    const doc = el.ownerDocument;
    const parts = [];
    if (el.id) {
      for (const label of doc.querySelectorAll("label[for]")) if (label.htmlFor === el.id) parts.push(textOf(label, 200));
    }
    const wrapping = el.closest("label");
    if (wrapping) {
      // The wrapping label's own words, without the control's value.
      const copy = wrapping.cloneNode(true);
      for (const control of copy.querySelectorAll("input,select,textarea")) control.remove();
      parts.push(clip(copy.textContent, 200));
    }
    return parts.filter(Boolean).join(" ");
  };

  P.name = (el, role = P.role(el)) => {
    const doc = el.ownerDocument;
    const labelledby = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => doc.getElementById(id)).filter(Boolean).map((node) => textOf(node, 200)).join(" ");
    if (labelledby.trim()) return clip(labelledby, 160);
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clip(aria, 160);
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return clip(el.value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : ""), 160);
      if (type === "image") return clip(el.getAttribute("alt") || "Submit", 160);
      if (type === "file") return clip(labelFor(el) || `Choose file (${el.getAttribute("accept") || "any file"})`, 160);
      const label = labelFor(el);
      if (label) return clip(label, 160);
      return clip(el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("name") || "", 160);
    }
    if (tag === "img" || tag === "area") return clip(el.getAttribute("alt") || el.getAttribute("title") || "", 160);
    if (tag === "iframe" || tag === "frame") return clip(el.getAttribute("title") || el.getAttribute("name") || "", 160);
    if (tag === "fieldset") return clip(el.querySelector(":scope > legend")?.textContent || "", 160);
    if (tag === "table") return clip(el.querySelector(":scope > caption")?.textContent || "", 160);
    if (nameFromContent.has(role) || tag === "summary") {
      const text = textOf(el, 160);
      if (text) return text;
      const image = el.querySelector("img[alt],svg[aria-label],[role=img][aria-label]");
      if (image) return clip(image.getAttribute("alt") || image.getAttribute("aria-label"), 160);
    }
    return clip(el.getAttribute("title") || "", 160);
  };

  /** Hidden from people and assistive technology: never listed or acted on. */
  P.hiddenSelf = (el) => {
    if (el.hidden || el.inert || el.getAttribute("aria-hidden") === "true") return true;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE" || tag === "HEAD" || tag === "META" || tag === "LINK") return true;
    if (tag === "INPUT" && (el.getAttribute("type") || "").toLowerCase() === "hidden") return true;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display === "none";
  };
  P.invisible = (el) => {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.visibility === "hidden" || style.visibility === "collapse";
  };
  P.hidden = (el) => {
    for (let node = el; node; node = node.parentElement || node.getRootNode?.().host || node.ownerDocument?.defaultView?.frameElement) {
      if (node.nodeType !== 1) break;
      if (P.hiddenSelf(node)) return true;
    }
    return P.invisible(el);
  };

  P.secret = (el) => {
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") return "";
    const type = (el.getAttribute("type") || "").toLowerCase();
    const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (type === "password" || /current-password|new-password/.test(auto)) return "password";
    if (/one-time-code/.test(auto)) return "one-time code";
    if (/cc-number|cc-csc|cc-exp/.test(auto) || /^(card|cc)[-_ ]?(number|num|cvc|cvv|csc)$/i.test(el.getAttribute("name") || "")) return "payment card";
    return "";
  };

  P.fingerprint = (el) => JSON.stringify([el.tagName, P.role(el), P.name(el).slice(0, 80), el.getAttribute("type") || "", el.getAttribute("href") || ""]);

  /** The chain of frame elements from the top document down to el's document. */
  P.frameChain = (el) => {
    const chain = [];
    for (let view = el.ownerDocument.defaultView; view && view !== view.parent; view = view.parent) {
      let frame;
      try { frame = view.frameElement; } catch { frame = null; }
      if (!frame) break;
      chain.unshift([frame, frame.contentDocument]);
    }
    return chain;
  };

  P.register = (el) => {
    let id = S.ids.get(el);
    if (!id) {
      id = `e${S.next++}`;
      S.ids.set(el, id);
    }
    S.refs.set(id, { el, frames: P.frameChain(el), fp: P.fingerprint(el) });
    return id;
  };

  P.semanticChanged = () => {
    if (!S.readSemantic) return false;
    try { return JSON.stringify(S.readSemantic()) !== S.semantic; } catch { return true; }
  };

  const stale = (error) => ({ ok: false, errorCode: "browser_snapshot_stale", attempted: false, error });

  /** Resolves a ref to its live element, or explains why it is stale. */
  P.resolve = (documentId, ref) => {
    if (!S.documentId || documentId !== S.documentId) return stale("The page changed since its snapshot. Take a new snapshot.");
    if (P.semanticChanged()) return stale("The account or reviewed content changed. Take a new snapshot before acting.");
    if (ref === undefined || ref === null || ref === "") return { ok: true, el: null };
    if (typeof ref !== "string" || !/^e\d{1,7}$/.test(ref)) return { ok: false, attempted: false, error: "Use a ref such as e12 from the latest snapshot." };
    const record = S.refs.get(ref);
    if (!record) return stale(`Ref ${ref} is not in the latest snapshot. Take a new snapshot.`);
    const { el, frames, fp } = record;
    const current = el.isConnected && frames.every(([frame, doc]) => frame.isConnected && frame.contentDocument === doc);
    if (!current || P.fingerprint(el) !== fp) {
      S.refs.delete(ref);
      return stale(`The control ${ref} changed or is gone. Take a new snapshot.`);
    }
    // Sites hide file inputs behind their own upload buttons; those stay usable.
    const fileInput = el.tagName === "INPUT" && el.type === "file";
    if (!fileInput && P.hidden(el)) return { ok: false, attempted: false, errorCode: "browser_target_hidden", error: `The control ${ref} is hidden now.` };
    return { ok: true, el };
  };

  /**
   * A ref-free description of el that survives page reloads, for replaying a
   * workflow: its role, its name and which of the same-named controls it is.
   */
  P.locatorOf = (el) => {
    if (!el) return null;
    const role = P.role(el) || "clickable";
    const name = P.name(el, role);
    let index = 0;
    for (const record of S.refs.values()) {
      const other = record.el;
      if (other === el || !other.isConnected) continue;
      if ((P.role(other) || "clickable") === role && P.name(other) === name &&
          (other.compareDocumentPosition(el) & 4)) index++;
    }
    return { role, name: P.clip(name, 200), index };
  };

  P.describe = (el) => {
    if (!el || el.nodeType !== 1) return "";
    const role = P.role(el) || el.tagName.toLowerCase();
    const name = P.name(el);
    return name ? `${role} "${clip(name, 60)}"` : role;
  };

  // Words that make a click send, buy, share or destroy something. A match asks
  // the person first (the account's "Ask before acting" setting decides how).
  const consequentialWords = /\b(send|post|publish|tweet|pay|buy|purchase|place order|order now|submit order|checkout|check out|donate|delete|remove|erase|destroy|discard|share|invite|transfer|withdraw|unsubscribe|cancel (my )?(subscription|membership|account|order)|make public|grant access|give access|submit|turn in|hand in)\b/i;
  const paymentForm = (form) => !!form && !!form.querySelector('[autocomplete^="cc-"],input[name*="card" i][name*="number" i]');

  /** Why acting on el would have consequences for other people or money, or "". */
  P.consequence = (el, action) => {
    if (!el) return "";
    const name = P.name(el);
    const form = el.form || el.closest?.("form");
    if (action === "key") {
      // Enter in a field submits its form the way its default button would.
      if (!form) return "";
      const submit = form.querySelector('button:not([type]),button[type=submit],input[type=submit],input[type=image]');
      if (paymentForm(form)) return "Pressing Enter submits a payment form.";
      if (submit && consequentialWords.test(P.name(submit))) return `Pressing Enter submits the form with “${clip(P.name(submit), 40)}”.`;
      return "";
    }
    if (consequentialWords.test(name)) return `“${clip(name, 60)}” may send, buy, share or delete something.`;
    const submits = el.matches?.('button:not([type]),button[type=submit],input[type=submit],input[type=image]') && form;
    if (submits && paymentForm(form)) return "This submits a payment form.";
    return "";
  };

  // The four kinds that always stop for the person in Misty, whatever the
  // model asked for (roadmap C2). Other consequential steps keep the
  // allowConsequential rule.
  const kindWords = [
    ["payment", /\b(pay|pay now|buy|buy now|purchase|place (your )?order|order now|submit order|complete (your )?(order|purchase|payment)|confirm (and pay|payment|purchase|order)|checkout|check out|donate|transfer|withdraw|send money|subscribe|start (my )?(subscription|membership|trial))\b/i],
    ["delete", /\b(delete|remove|erase|destroy|discard|empty trash|permanently|cancel (my )?(subscription|membership|account|order)|close (my )?account)\b/i],
    ["publish", /\b(publish|make public|go live|post|tweet|share publicly|share)\b/i],
    ["send", /\b(send|reply|reply all|forward|comment|message)\b/i],
  ];
  const kindOfName = (name) => kindWords.find(([, words]) => words.test(name || ""))?.[0] ?? "";

  /** "payment", "send", "delete", "publish" or "" for acting on el. */
  P.consequenceKind = (el, action) => {
    if (!el) return "";
    const form = el.form || el.closest?.("form");
    if (action === "key") {
      if (!form) return "";
      if (paymentForm(form)) return "payment";
      const submit = form.querySelector('button:not([type]),button[type=submit],input[type=submit],input[type=image]');
      return submit ? kindOfName(P.name(submit)) : "";
    }
    const named = kindOfName(P.name(el));
    if (named) return named;
    const submits = el.matches?.('button:not([type]),button[type=submit],input[type=submit],input[type=image]') && form;
    return submits && paymentForm(form) ? "payment" : "";
  };
})(globalThis.__mistyAgentPageV1 ??= {});
