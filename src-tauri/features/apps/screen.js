(function () {
  "use strict";
  var port = null;
  var lastInput = 0;

  function px(x, y) {
    return { x: Math.round(x * window.innerWidth), y: Math.round(y * window.innerHeight) };
  }

  function visible(element) {
    var box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 &&
      box.top < window.innerHeight && box.left < window.innerWidth;
  }

  function nameOf(element) {
    var label = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("alt") ||
      element.getAttribute("placeholder") || (element.innerText || element.value || "");
    return String(label).replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function read() {
    var selector = "a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem]," +
      "[role=checkbox],[contenteditable=true],canvas";
    var controls = [];
    var nodes = document.querySelectorAll(selector);
    for (var index = 0; index < nodes.length && controls.length < 200; index++) {
      var element = nodes[index];
      if (!visible(element)) continue;
      var box = element.getBoundingClientRect();
      controls.push({
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        name: nameOf(element),
        x: +((box.left + box.width / 2) / window.innerWidth).toFixed(4),
        y: +((box.top + box.height / 2) / window.innerHeight).toFixed(4),
        width: +(box.width / window.innerWidth).toFixed(4),
        height: +(box.height / window.innerHeight).toFixed(4),
      });
    }
    var text = (document.body && document.body.innerText) || "";
    return {
      title: document.title,
      text: text.replace(/\n{3,}/g, "\n\n").slice(0, 8000),
      controls: controls,
      canvasOnly: controls.length > 0 && controls.every(function (control) { return control.role === "canvas"; }),
    };
  }

  function look() {
    var canvases = Array.prototype.slice.call(document.querySelectorAll("canvas")).filter(visible);
    canvases.sort(function (a, b) { return b.width * b.height - a.width * a.height; });
    for (var index = 0; index < canvases.length; index++) {
      try {
        var url = canvases[index].toDataURL("image/png");
        if (url && url.length > 100) return { dataUrl: url };
      } catch (error) {
      }
    }
    return { dataUrl: null };
  }

  function mouse(type, target, at, detail) {
    var init = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, button: 0,
      buttons: type.indexOf("down") >= 0 ? 1 : 0, detail: detail || 1, view: window };
    var event = type.indexOf("pointer") === 0
      ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true }, init))
      : new MouseEvent(type, init);
    target.dispatchEvent(event);
  }

  function click(args) {
    var at = px(args.x, args.y);
    var target = document.elementFromPoint(at.x, at.y);
    if (!target) throw new Error("There's nothing at that point.");
    var times = args.double ? 2 : 1;
    for (var count = 1; count <= times; count++) {
      mouse("pointerdown", target, at, count);
      mouse("mousedown", target, at, count);
      if (typeof target.focus === "function") target.focus({ preventScroll: true });
      mouse("pointerup", target, at, count);
      mouse("mouseup", target, at, count);
      mouse("click", target, at, count);
    }
    if (args.double) mouse("dblclick", target, at, 2);
    return { clicked: nameOf(target) || target.tagName.toLowerCase() };
  }

  function key(args) {
    var target = document.activeElement || document.body;
    var init = { key: args.key, bubbles: true, cancelable: true, composed: true, ctrlKey: !!args.ctrl,
      shiftKey: !!args.shift, altKey: !!args.alt, metaKey: !!args.meta };
    var allowed = target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    return { allowed: allowed };
  }

  function type(args) {
    var target = document.activeElement || document.body;
    var text = String(args.text || "");
    var editable = target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName);
    if (editable && document.execCommand && document.execCommand("insertText", false, text)) return { typed: text.length };
    if (editable && "value" in target) {
      var start = target.selectionStart != null ? target.selectionStart : target.value.length;
      var end = target.selectionEnd != null ? target.selectionEnd : target.value.length;
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return { typed: text.length };
    }
    for (var index = 0; index < text.length; index++) {
      var character = text[index];
      var init = { key: character, bubbles: true, cancelable: true, composed: true };
      target.dispatchEvent(new KeyboardEvent("keydown", init));
      target.dispatchEvent(new KeyboardEvent("keypress", init));
      target.dispatchEvent(new KeyboardEvent("keyup", init));
    }
    return { typed: text.length };
  }

  function scroll(args) {
    var at = px(args.x, args.y);
    var target = document.elementFromPoint(at.x, at.y) || document.scrollingElement || document.body;
    var dy = Math.round(Number(args.dy || 0) * window.innerHeight);
    target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, deltaY: dy }));
    if (target.scrollBy) target.scrollBy({ top: dy });
    return { scrolled: dy };
  }

  function adapterTools() {
    var adapter = window.mistyAdapter;
    return { tools: adapter && Array.isArray(adapter.tools) ? adapter.tools : [] };
  }
  function adapterCall(args) {
    var adapter = window.mistyAdapter;
    if (!adapter || typeof adapter.call !== "function") throw new Error("This app has no adapter.");
    var agent = args.agent && typeof args.agent.id === "string" ? { id: args.agent.id, name: String(args.agent.name || "Agent") } : null;
    return adapter.call(String(args.name || ""), args.args || {}, { agent: agent });
  }

  var commands = {
    read: read, look: look, click: click, key: key, type: type, scroll: scroll,
    "adapter.tools": adapterTools, "adapter.call": adapterCall,
  };

  function personInput(event) {
    if (!event.isTrusted || !port) return;
    var now = Date.now();
    if (now - lastInput < 500) return;
    lastInput = now;
    port.postMessage({ t: "input" });
  }
  window.addEventListener("pointerdown", personInput, true);
  window.addEventListener("keydown", personInput, true);

  function attach(next) {
    port = next;
    port.onmessage = function (message) {
      var frame = message.data;
      if (!frame || frame.t !== "cmd" || typeof frame.id !== "number") return;
      var run = commands[frame.name];
      var fail = function (error) {
        port.postMessage({ t: "cmd-res", id: frame.id, ok: false, error: String(error && error.message || error) });
      };
      try {
        if (!run) throw new Error("Misty's screen helper doesn't know " + frame.name + ".");
        Promise.resolve(run(frame.args || {})).then(function (result) {
          port.postMessage({ t: "cmd-res", id: frame.id, ok: true, result: result });
        }, fail);
      } catch (error) {
        fail(error);
      }
    };
  }

  Object.defineProperty(window, "__mistyScreenAttach", { value: attach, writable: false, configurable: false });
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.type !== "misty:screen" || !event.ports[0]) return;
    attach(event.ports[0]);
  });
})();
