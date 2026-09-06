(() => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") return;
  const denied = () => Promise.reject(new DOMException("Use a granted Misty capability for this operation.", "NotAllowedError"));
  const hideGlobal = (name) => {
    try {
      Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
    } catch (_) {}
  };
  // WebView2 has no per-view switch for PeerConnection and no native event for
  // the HTML file input dialog. CSP blocks frames/workers and this document-start
  // guard removes those ambient APIs from the only remaining JavaScript realm.
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) hideGlobal(name);
  const media = navigator.mediaDevices;
  if (media) {
    for (const name of ["getUserMedia", "getDisplayMedia", "enumerateDevices", "selectAudioOutput"]) {
      try { Object.defineProperty(media, name, { value: denied, writable: false, configurable: false }); } catch (_) {}
    }
  }
  const clipboard = navigator.clipboard;
  if (clipboard) {
    for (const name of ["read", "readText", "write", "writeText"]) {
      try { Object.defineProperty(clipboard, name, { value: denied, writable: false, configurable: false }); } catch (_) {}
    }
  }
  const fileInput = (node) => node instanceof HTMLInputElement && node.type.toLowerCase() === "file";
  const originalInputClick = HTMLInputElement.prototype.click;
  Object.defineProperty(HTMLInputElement.prototype, "click", {
    value: function () { if (fileInput(this)) throw new DOMException("Use the Misty file capability.", "NotAllowedError"); return originalInputClick.call(this); },
    writable: false,
    configurable: false,
  });
  const originalShowPicker = HTMLInputElement.prototype.showPicker;
  if (typeof originalShowPicker === "function") Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
    value: function () { if (fileInput(this)) throw new DOMException("Use the Misty file capability.", "NotAllowedError"); return originalShowPicker.call(this); },
    writable: false,
    configurable: false,
  });
  window.addEventListener("click", (event) => {
    const path = event.composedPath();
    const opensFile = path.some((node) => fileInput(node) || (node instanceof HTMLLabelElement && fileInput(node.control)));
    if (opensFile) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  for (const kind of ["dragenter", "dragover", "drop"]) window.addEventListener(kind, (event) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  const encode = (value) => {
    if (value instanceof ArrayBuffer) return { $mistyBytes: Array.from(new Uint8Array(value)) };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    return value;
  };
  const decode = (value) => {
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") {
      if (Object.keys(value).length === 1 && Array.isArray(value.$mistyBytes)) return new Uint8Array(value.$mistyBytes).buffer;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    }
    return value;
  };
  const request = (message) => invoke("mini_app_rpc", { message: encode(message) }).then(decode);
  Object.defineProperty(window, "mistyHost", {
    value: Object.freeze({ request }), writable: false, configurable: false,
  });
  // Compatibility for installed SDK bundles. This document is a top-level
  // native view; parent === window. No iframe or host Window is exposed.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    const appRpc = message?.type === "misty:app-rpc" && message.protocol === 2;
    const extensionRpc = message?.channel === "misty-plugin" && message.kind === "request";
    const lifecycle = message?.type === "misty:app-ready" || message?.type === "misty:app-error" || message?.type === "misty:app-tab-change" || (message?.channel === "misty-plugin" && message.kind === "ready");
    if (!appRpc && !extensionRpc && !lifecycle) return;
    const respond = (ok, result, error) => {
      if (!appRpc && !extensionRpc) return;
      const response = appRpc
        ? { type: "misty:app-rpc-response", protocol: 2, requestId: message.requestId, ok, result, error: error ? {code: "capability_denied", message: error} : undefined }
        : { channel: "misty-host", kind: "response", requestId: message.requestId, ok, result, error };
      window.dispatchEvent(new MessageEvent("message", {data: response, source: window}));
    };
    request(message).then((result) => respond(true, result), (error) => respond(false, undefined, String(error)));
  });
})();
