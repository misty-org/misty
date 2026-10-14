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

  /** Whether a wait condition holds now. Rust polls this; it makes no model calls. */
  P.waitCheck = (args) => {
    const body = (document.body?.innerText ?? document.body?.textContent ?? "").toLowerCase();
    const checks = [];
    if (args.text) checks.push(body.includes(String(args.text).toLowerCase()));
    if (args.textGone) checks.push(!body.includes(String(args.textGone).toLowerCase()));
    if (args.urlIncludes) checks.push(location.href.includes(String(args.urlIncludes)));
    return { ok: true, met: checks.length > 0 && checks.every(Boolean), ready: document.readyState === "complete", url: location.href };
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

  const operations = {
    snapshot: (args) => P.snapshot(args), find: (args) => P.find(args), markdown: (args) => P.markdown(args),
    prepare: (args) => P.prepare(args), perform: (args) => P.perform(args), observe: () => P.observe(),
    waitCheck: (args) => P.waitCheck(args), settle: (args) => P.settle(args),
    skill: (args) => P.skill(args), locate: (args) => P.locate(args),
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
