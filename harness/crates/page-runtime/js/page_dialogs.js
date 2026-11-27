(() => {
  const key = Symbol.for("misty.dialogs");
  if (window[key]) return;
  Object.defineProperty(window, key, { value: true });
  const ACTING = "data-misty-acting";
  const ARMED = "data-misty-dialog-answer";
  const SEEN = "data-misty-dialog";
  const root = () => document.documentElement;
  const original = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
  const answer = (kind, message, fallback, args) => {
    const el = root();
    if (!el || !el.hasAttribute(ACTING)) return original[kind].apply(window, args);
    let armed = null;
    try { armed = JSON.parse(el.getAttribute(ARMED) || "null"); } catch { armed = null; }
    el.removeAttribute(ARMED);
    if (!armed && el.hasAttribute("data-misty-dialog-hold")) return original[kind].apply(window, args);
    const accept = kind === "alert" || armed?.accept === true;
    const text = kind === "prompt" && accept
      ? (typeof armed?.text === "string" ? armed.text : String(fallback ?? ""))
      : undefined;
    el.setAttribute(SEEN, JSON.stringify({
      kind, message: String(message ?? "").slice(0, 500), accepted: accept, ...(text === undefined ? {} : { text }),
    }));
    if (kind === "alert") return undefined;
    if (kind === "confirm") return accept;
    return accept ? text : null;
  };
  window.alert = function (message) { return answer("alert", message, undefined, arguments); };
  window.confirm = function (message) { return answer("confirm", message, undefined, arguments); };
  window.prompt = function (message, fallback) { return answer("prompt", message, fallback, arguments); };

  const CHOOSER = "data-misty-file-chooser";
  const acting = () => !!root()?.hasAttribute(ACTING);
  const choose = (input) => {
    for (const marked of document.querySelectorAll(`[${CHOOSER}]`)) marked.removeAttribute(CHOOSER);
    input.setAttribute(CHOOSER, "");
  };
  const fileInput = (node) => node instanceof HTMLInputElement && node.type === "file";
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (fileInput(this) && acting()) return choose(this);
    return click.apply(this, arguments);
  };
  if (typeof HTMLInputElement.prototype.showPicker === "function") {
    const showPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () {
      if (fileInput(this) && acting()) return choose(this);
      return showPicker.apply(this, arguments);
    };
  }
  window.addEventListener("click", (event) => {
    const target = event.composedPath?.()[0] ?? event.target;
    if (!fileInput(target) || !acting()) return;
    event.preventDefault();
    choose(target);
  }, true);
})();
