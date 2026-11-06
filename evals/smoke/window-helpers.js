// Runs once in the window: keeps the console's errors, and gives the smoke test a way to work the
// real interface (click what a person would click, type what they would type).
if (!window.__smoke) {
  const errors = [];
  const keep = (kind, parts) =>
    errors.push({ kind, at: Date.now(), text: parts.map((part) => (part instanceof Error ? part.stack || part.message : typeof part === "string" ? part : (() => { try { return JSON.stringify(part); } catch { return String(part); } })())).join(" ").slice(0, 2000) });
  const originalError = console.error.bind(console);
  console.error = (...parts) => { keep("console.error", parts); originalError(...parts); };
  const originalWarn = console.warn.bind(console);
  console.warn = (...parts) => { keep("console.warn", parts); originalWarn(...parts); };
  window.addEventListener("error", (event) => keep("error", [event.message]));
  window.addEventListener("unhandledrejection", (event) => keep("rejection", [event.reason]));
  const visible = (element) => element.getClientRects().length > 0;
  const named = (element) => (element.innerText || element.getAttribute("aria-label") || element.value || "").trim();
  const repo = __REPO__;
  window.__smoke = {
    errors,
    /** The app's own module, the same instance the app uses. */
    module: (path) => import(`/@fs${repo}/src/${path}`),
    invoke: (command, args) => window.__TAURI_INTERNALS__.invoke(command, args),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    text: () => document.body.innerText,
    async until(check, label, timeoutMs = 20000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}. Page: ${document.body.innerText.slice(0, 400)}`);
        await new Promise((done) => setTimeout(done, 100));
      }
    },
    /** Clicks the visible button or link whose text is exactly this. */
    async click(label, timeoutMs = 20000) {
      const element = await window.__smoke.until(
        () => [...document.querySelectorAll("button, a, [role=button], [role=menuitem], [role=menuitemradio], [role=option]")]
          .find((item) => visible(item) && !item.disabled && named(item) === label),
        `the control "${label}"`, timeoutMs);
      element.click();
    },
    /** Types into a field through React's own value setter. */
    async type(selector, value, timeoutMs = 20000) {
      const input = await window.__smoke.until(() => document.querySelector(selector), selector, timeoutMs);
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    async submit(selector, timeoutMs = 20000) {
      const form = await window.__smoke.until(() => document.querySelector(selector)?.closest("form"), selector, timeoutMs);
      form.requestSubmit();
    },
  };
}
