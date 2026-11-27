(function () {
  "use strict";
  var port = null;
  var lastInput = 0;
  var agentAt = 0;
  var chooser = null;
  var nextRef = 1;
  var refOf = new WeakMap();
  var byRef = new Map();
  var WAIT_LIMIT = 8000;
  var DEFAULT_POINT_MS = 150;
  var callsRunning = 0;
  var holdUntil = 0;
  var HOLD_LIMIT = 30000;
  var dialogAnswer = null;
  var lastDialog = null;

  function px(x, y) {
    return { x: Math.round(x * window.innerWidth), y: Math.round(y * window.innerHeight) };
  }

  function fractions(at) {
    return { x: +(at.x / window.innerWidth).toFixed(4), y: +(at.y / window.innerHeight).toFixed(4) };
  }

  function visible(element) {
    var box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 &&
      box.top < window.innerHeight && box.left < window.innerWidth;
  }

  function nameOf(element) {
    var labelled = element.getAttribute("aria-labelledby");
    var label = labelled && document.getElementById(labelled);
    var named = element.getAttribute("aria-label") || (label && label.innerText) || element.getAttribute("title") ||
      element.getAttribute("alt") || (element.labels && element.labels[0] && element.labels[0].innerText) ||
      element.getAttribute("placeholder") || (element.innerText || element.value || "");
    return String(named).replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function refFor(element) {
    var ref = refOf.get(element);
    if (!ref) {
      ref = "e" + nextRef++;
      refOf.set(element, ref);
    }
    byRef.set(ref, new WeakRef(element));
    return ref;
  }

  function agentActing() {
    return callsRunning > 0 || holding() || Date.now() - agentAt < 4000 && lastInput < agentAt;
  }

  function acted() {
    agentAt = Date.now();
    lastDialog = null;
  }

  function answerDialog(kind, message, fallback, original, args) {
    if (!agentActing()) return original.apply(window, args);
    var armed = dialogAnswer;
    dialogAnswer = null;
    var accept = kind === "alert" ? true : !!(armed && armed.accept);
    lastDialog = { kind: kind, message: String(message === undefined ? "" : message).slice(0, 500), accepted: accept };
    if (kind === "alert") return undefined;
    if (kind === "confirm") return accept;
    if (!accept) return null;
    return armed && typeof armed.text === "string" ? armed.text : String(fallback === undefined ? "" : fallback);
  }

  var originalAlert = window.alert;
  var originalConfirm = window.confirm;
  var originalPrompt = window.prompt;
  window.alert = function (message) { return answerDialog("alert", message, undefined, originalAlert, arguments); };
  window.confirm = function (message) { return answerDialog("confirm", message, undefined, originalConfirm, arguments); };
  window.prompt = function (message, fallback) { return answerDialog("prompt", message, fallback, originalPrompt, arguments); };

  function dialog(args) {
    dialogAnswer = { accept: args.accept !== false, text: typeof args.text === "string" ? args.text : undefined };
    return { armed: true };
  }

  function stateOf(element) {
    var state = {};
    if (element.disabled || element.getAttribute("aria-disabled") === "true") state.disabled = true;
    if (element.type === "checkbox" || element.type === "radio") state.checked = !!element.checked;
    else if (element.getAttribute("aria-checked")) state.checked = element.getAttribute("aria-checked") === "true";
    if (element.getAttribute("aria-selected") === "true") state.selected = true;
    if (element.getAttribute("aria-expanded")) state.expanded = element.getAttribute("aria-expanded") === "true";
    if (element.tagName === "SELECT") {
      state.value = element.value;
      state.options = Array.prototype.slice.call(element.options, 0, 50).map(function (option) {
        return option.label || option.text;
      });
    } else if (/^(INPUT|TEXTAREA)$/.test(element.tagName) && element.type !== "checkbox" && element.type !== "radio" &&
      element.type !== "password" && element.type !== "file") {
      state.value = String(element.value || "").slice(0, 200);
    }
    if (element.type === "file") state.file = true;
    if (element === document.activeElement) state.focused = true;
    return state;
  }

  var CONTROLS = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem]," +
    "[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch]," +
    "[role=combobox],[role=slider],[role=treeitem],[role=gridcell],[contenteditable=true],[draggable=true]," +
    "[tabindex]:not([tabindex='-1']),canvas";

  function read() {
    var controls = [];
    var nodes = document.querySelectorAll(CONTROLS);
    for (var index = 0; index < nodes.length && controls.length < 300; index++) {
      var element = nodes[index];
      if (!visible(element) && !(element.type === "file" && element.isConnected)) continue;
      var box = element.getBoundingClientRect();
      var control = {
        ref: refFor(element),
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        name: nameOf(element),
        x: +((box.left + box.width / 2) / window.innerWidth).toFixed(4),
        y: +((box.top + box.height / 2) / window.innerHeight).toFixed(4),
        width: +(box.width / window.innerWidth).toFixed(4),
        height: +(box.height / window.innerHeight).toFixed(4),
      };
      var state = stateOf(element);
      for (var key in state) control[key] = state[key];
      controls.push(control);
    }
    var text = (document.body && document.body.innerText) || "";
    return {
      title: document.title,
      text: text.replace(/\n{3,}/g, "\n\n").slice(0, 8000),
      controls: controls,
      canvasOnly: controls.length > 0 && controls.every(function (control) { return control.role === "canvas"; }),
      fileChooser: !!chooser,
      dialog: lastDialog,
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

  function byRefOrThrow(ref) {
    var held = byRef.get(String(ref));
    var element = held && held.deref();
    if (!element || !element.isConnected) throw new Error("Element " + ref + " is gone. Read the screen again for fresh refs.");
    return element;
  }

  function target(args) {
    if (args.ref) {
      var element = byRefOrThrow(args.ref);
      if (!visible(element) && element.type !== "file") element.scrollIntoView({ block: "center", inline: "center" });
      var box = element.getBoundingClientRect();
      return { element: element, at: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } };
    }
    if (typeof args.x !== "number" || typeof args.y !== "number") throw new Error("Give a ref from screen_read, or x and y.");
    var at = px(args.x, args.y);
    var found = document.elementFromPoint(at.x, at.y);
    if (!found) throw new Error("There's nothing at that point.");
    return { element: found, at: at };
  }

  function locate(args) {
    return fractions(target(args).at);
  }

  function mouse(type, element, at, detail, extra) {
    var init = { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, button: 0,
      buttons: type.indexOf("down") >= 0 || type.indexOf("move") >= 0 && extra && extra.held ? 1 : 0,
      detail: detail || 1, view: window };
    var event = type.indexOf("pointer") === 0
      ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true }, init))
      : new MouseEvent(type, init);
    return element.dispatchEvent(event);
  }

  function frame() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { setTimeout(resolve, 0); });
    });
  }

  function settled(result) {
    return frame().then(frame).then(function () {
      if (chooser) result.fileChooser = true;
      if (lastDialog) result.dialog = lastDialog;
      return result;
    });
  }

  function hoverAt(element, at) {
    mouse("pointerover", element, at);
    mouse("pointerenter", element, at);
    mouse("mouseover", element, at);
    mouse("mouseenter", element, at);
    mouse("pointermove", element, at);
    mouse("mousemove", element, at);
  }

  function clickElement(element, at, times) {
    hoverAt(element, at);
    for (var count = 1; count <= times; count++) {
      mouse("pointerdown", element, at, count);
      mouse("mousedown", element, at, count);
      if (typeof element.focus === "function") element.focus({ preventScroll: true });
      mouse("pointerup", element, at, count);
      mouse("mouseup", element, at, count);
      mouse("click", element, at, count);
    }
    if (times > 1) mouse("dblclick", element, at, 2);
  }

  function click(args) {
    acted();
    var found = target(args);
    clickElement(found.element, found.at, args.double ? 2 : 1);
    return settled({ clicked: nameOf(found.element) || found.element.tagName.toLowerCase() });
  }

  function hover(args) {
    acted();
    var found = target(args);
    hoverAt(found.element, found.at);
    return settled({ hovering: nameOf(found.element) || found.element.tagName.toLowerCase() });
  }

  function drag(args) {
    acted();
    var from = target(args.from || {});
    var to = target(args.to || {});
    var source = from.element.closest && from.element.closest("[draggable=true]");
    var steps = 12;
    var pointAt = function (step) {
      return {
        x: Math.round(from.at.x + (to.at.x - from.at.x) * step / steps),
        y: Math.round(from.at.y + (to.at.y - from.at.y) * step / steps),
      };
    };
    hoverAt(from.element, from.at);
    mouse("pointerdown", from.element, from.at);
    mouse("mousedown", from.element, from.at);
    var transfer = source && typeof DataTransfer === "function" ? new DataTransfer() : null;
    if (transfer) source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: from.at.x, clientY: from.at.y }));
    var step = 1;
    var move = function () {
      var at = pointAt(step);
      var under = document.elementFromPoint(at.x, at.y) || to.element;
      mouse("pointermove", under, at, 1, { held: true });
      mouse("mousemove", under, at, 1, { held: true });
      if (transfer) {
        under.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: at.x, clientY: at.y }));
        under.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: at.x, clientY: at.y }));
      }
      step++;
      if (step <= steps) return frame().then(move);
      var end = document.elementFromPoint(to.at.x, to.at.y) || to.element;
      if (transfer) {
        end.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: to.at.x, clientY: to.at.y }));
        source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: to.at.x, clientY: to.at.y }));
      }
      mouse("pointerup", end, to.at);
      mouse("mouseup", end, to.at);
      return { dropped: nameOf(end) || end.tagName.toLowerCase() };
    };
    return frame().then(move).then(settled);
  }

  var valueSetter = {
    INPUT: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set,
    TEXTAREA: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set,
  };

  function setValue(element, value) {
    var setter = valueSetter[element.tagName];
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function chooseOptions(element, values) {
    if (element.tagName !== "SELECT") {
      throw new Error("That isn't a list box. Click it to open it, then click the option.");
    }
    var wanted = (Array.isArray(values) ? values : [values]).map(String);
    var matched = 0;
    Array.prototype.forEach.call(element.options, function (option) {
      var hit = wanted.indexOf(option.value) >= 0 || wanted.indexOf(option.label) >= 0 || wanted.indexOf(option.text.trim()) >= 0;
      if (hit) matched++;
      if (element.multiple || hit) option.selected = hit;
    });
    if (!matched) throw new Error("None of those options is in the list. Read the screen to see its options.");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return matched;
  }

  function select(args) {
    acted();
    var element = byRefOrThrow(args.ref);
    return settled({ selected: chooseOptions(element, args.values) });
  }

  function fillOne(field) {
    var element = byRefOrThrow(field.ref);
    var value = field.value;
    if (element.type === "checkbox" || element.type === "radio" || /^(checkbox|switch|radio)$/.test(element.getAttribute("role") || "")) {
      var on = element.type ? !!element.checked : element.getAttribute("aria-checked") === "true";
      if (on !== (value === true || value === "true")) {
        var box = element.getBoundingClientRect();
        clickElement(element, { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }, 1);
      }
      return;
    }
    if (element.tagName === "SELECT") {
      chooseOptions(element, value);
      return;
    }
    if (typeof element.focus === "function") element.focus({ preventScroll: true });
    if (element.isContentEditable) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, String(value));
      return;
    }
    if (!/^(INPUT|TEXTAREA)$/.test(element.tagName)) throw new Error("Element " + field.ref + " isn't a field.");
    setValue(element, String(value));
  }

  function fill(args) {
    acted();
    var fields = Array.isArray(args.fields) ? args.fields : [];
    if (!fields.length) throw new Error("Give the fields to fill, each a ref and a value.");
    fields.forEach(fillOne);
    return settled({ filled: fields.length });
  }

  function key(args) {
    acted();
    var element = document.activeElement || document.body;
    var init = { key: args.key, bubbles: true, cancelable: true, composed: true, ctrlKey: !!args.ctrl,
      shiftKey: !!args.shift, altKey: !!args.alt, metaKey: !!args.meta };
    var allowed = element.dispatchEvent(new KeyboardEvent("keydown", init));
    element.dispatchEvent(new KeyboardEvent("keyup", init));
    if (allowed && args.key === "Enter" && element.form && typeof element.form.requestSubmit === "function" &&
      element.tagName === "INPUT") {
      element.form.requestSubmit();
    }
    return settled({ allowed: allowed });
  }

  function type(args) {
    acted();
    if (args.ref) {
      var found = target(args);
      clickElement(found.element, found.at, 1);
    }
    var element = document.activeElement || document.body;
    var text = String(args.text || "");
    var editable = element.isContentEditable || /^(INPUT|TEXTAREA)$/.test(element.tagName);
    var typed = function () {
      if (editable && document.execCommand && document.execCommand("insertText", false, text)) return;
      if (editable && "value" in element) {
        var start = element.selectionStart != null ? element.selectionStart : element.value.length;
        var end = element.selectionEnd != null ? element.selectionEnd : element.value.length;
        setValue(element, element.value.slice(0, start) + text + element.value.slice(end));
        return;
      }
      for (var index = 0; index < text.length; index++) {
        var init = { key: text[index], bubbles: true, cancelable: true, composed: true };
        element.dispatchEvent(new KeyboardEvent("keydown", init));
        element.dispatchEvent(new KeyboardEvent("keypress", init));
        element.dispatchEvent(new KeyboardEvent("keyup", init));
      }
    };
    typed();
    if (args.submit) return key({ key: "Enter" }).then(function () { return { typed: text.length, submitted: true }; });
    return settled({ typed: text.length });
  }

  function scroll(args) {
    acted();
    var found = args.ref || typeof args.x === "number" ? target(args) : { element: document.scrollingElement || document.body, at: px(0.5, 0.5) };
    var dy = Math.round(Number(args.dy || 0) * window.innerHeight);
    found.element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: found.at.x, clientY: found.at.y, deltaY: dy }));
    if (found.element.scrollBy) found.element.scrollBy({ top: dy });
    return { scrolled: dy };
  }

  function wait(args) {
    var text = typeof args.text === "string" ? args.text : "";
    var gone = typeof args.gone === "string" ? args.gone : "";
    var limit = Math.min(Math.max(Number(args.timeout) || WAIT_LIMIT, 0), WAIT_LIMIT);
    var met = function () {
      var shown = (document.body && document.body.innerText) || "";
      if (text && shown.indexOf(text) < 0) return false;
      if (gone && shown.indexOf(gone) >= 0) return false;
      return !!(text || gone);
    };
    if (!text && !gone) {
      return new Promise(function (resolve) { setTimeout(function () { resolve({ waited: limit }); }, limit); });
    }
    if (met()) return { met: true };
    return new Promise(function (resolve) {
      var watcher = new MutationObserver(function () {
        if (!met()) return;
        watcher.disconnect();
        clearTimeout(timer);
        resolve({ met: true });
      });
      var timer = setTimeout(function () {
        watcher.disconnect();
        resolve({ met: false });
      }, limit);
      watcher.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    });
  }

  function filesOf(list) {
    return (Array.isArray(list) ? list : []).map(function (file) {
      if (file instanceof File) return file;
      return new File([file.data], String(file.name || "file"), { type: String(file.type || "") });
    });
  }

  function giveFiles(element, files) {
    var transfer = new DataTransfer();
    files.forEach(function (file) { transfer.items.add(file); });
    if (element.tagName === "INPUT" && element.type === "file") {
      element.files = transfer.files;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return "chooser";
    }
    var box = element.getBoundingClientRect();
    var at = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) };
    var init = Object.assign({ bubbles: true, cancelable: true, dataTransfer: transfer }, at);
    element.dispatchEvent(new DragEvent("dragenter", init));
    element.dispatchEvent(new DragEvent("dragover", init));
    element.dispatchEvent(new DragEvent("drop", init));
    return "dropped";
  }

  function upload(args) {
    acted();
    var files = filesOf(args.files);
    if (!files.length) throw new Error("Give the files to hand over.");
    var element = args.ref || typeof args.x === "number" ? target(args).element : chooser;
    if (!element) {
      throw new Error("Nothing in the app is asking for a file. Click the control that opens its file picker first " +
        "(it answers with fileChooser: true), or pass the ref of the place to drop the files on.");
    }
    if (element === chooser) chooser = null;
    var how = giveFiles(element, files);
    return settled({ handed: files.map(function (file) { return file.name; }), how: how });
  }

  var originalInputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === "file" && agentActing()) {
      chooser = this;
      return;
    }
    return originalInputClick.apply(this, arguments);
  };
  if (typeof HTMLInputElement.prototype.showPicker === "function") {
    var originalShowPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () {
      if (this.type === "file" && agentActing()) {
        chooser = this;
        return;
      }
      return originalShowPicker.apply(this, arguments);
    };
  }
  window.addEventListener("click", function (event) {
    var element = event.target;
    if (!element || element.tagName !== "INPUT" || element.type !== "file" || !agentActing()) return;
    event.preventDefault();
    chooser = element;
  }, true);

  window.mistyScreen = Object.freeze({ agentActing: agentActing });

  function ownContext() {
    var tools = new Map();
    var context = new EventTarget();
    var handler = null;
    var changed = function () {
      var event = new Event("toolchange");
      context.dispatchEvent(event);
    };
    Object.defineProperty(context, "ontoolchange", {
      get: function () { return handler; },
      set: function (next) {
        if (handler) context.removeEventListener("toolchange", handler);
        handler = typeof next === "function" ? next : null;
        if (handler) context.addEventListener("toolchange", handler);
      },
    });
    context.registerTool = function (tool, options) {
      var name = tool && tool.name;
      if (typeof name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(name)) {
        return Promise.reject(new DOMException("A tool's name is 1 to 128 letters, digits, _, - or .", "InvalidStateError"));
      }
      if (typeof tool.description !== "string" || !tool.description) {
        return Promise.reject(new DOMException("A tool needs a description.", "InvalidStateError"));
      }
      if (typeof tool.execute !== "function") {
        return Promise.reject(new DOMException("A tool needs execute.", "InvalidStateError"));
      }
      if (tools.has(name)) return Promise.reject(new DOMException(name + " is already registered.", "InvalidStateError"));
      var signal = options && options.signal;
      if (signal && signal.aborted) return Promise.resolve();
      tools.set(name, tool);
      if (signal) {
        signal.addEventListener("abort", function () {
          if (tools.get(name) !== tool) return;
          tools.delete(name);
          changed();
        }, { once: true });
      }
      changed();
      return Promise.resolve();
    };
    context.getTools = function () {
      return Promise.resolve(Array.from(tools.values()).sort(function (a, b) {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      }).map(function (tool) {
        return {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          origin: location.origin,
        };
      }));
    };
    context.executeTool = function (described, input, options) {
      var tool = tools.get(described && described.name);
      if (!tool) return Promise.reject(new DOMException("There is no tool called " + (described && described.name) + ".", "NotFoundError"));
      var signal = (options && options.signal) || new AbortController().signal;
      return Promise.resolve()
        .then(function () { return tool.execute(input || {}, { signal: signal }); })
        .then(function (result) { return JSON.stringify(result === undefined ? null : result); });
    };
    context.waitForToolsUntil = function (promise) {
      Promise.resolve(promise).then(changed, changed);
    };
    context.__mistyTool = function (name) {
      return tools.get(name);
    };
    return context;
  }

  if (!document.modelContext) {
    try {
      Object.defineProperty(document, "modelContext", { value: ownContext(), configurable: true });
    } catch (error) {
    }
  }

  function listTools() {
    var context = document.modelContext;
    var fromContext = context && typeof context.getTools === "function"
      ? Promise.resolve(context.getTools()).catch(function () { return []; })
      : Promise.resolve([]);
    return fromContext.then(function (tools) {
      var listed = (tools || []).map(function (tool) {
        return {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema || { type: "object" },
          annotations: tool.annotations,
        };
      });
      var adapter = window.mistyAdapter;
      var names = new Set(listed.map(function (tool) { return tool.name; }));
      (adapter && Array.isArray(adapter.tools) ? adapter.tools : []).forEach(function (tool) {
        if (tool && !names.has(tool.name)) listed.push(tool);
      });
      return { tools: listed };
    });
  }

  var running = new Map();

  function spotOf(where) {
    if (where && typeof where.getBoundingClientRect === "function") where = where.getBoundingClientRect();
    if (where && typeof where.width === "number" && typeof where.left === "number") {
      return {
        x: (where.left + where.width / 2) / window.innerWidth,
        y: (where.top + where.height / 2) / window.innerHeight,
      };
    }
    if (where && typeof where.x === "number" && typeof where.y === "number" && where.x >= 0 && where.x <= 1 &&
      where.y >= 0 && where.y <= 1) {
      return { x: where.x, y: where.y };
    }
    return null;
  }

  function workspace() {
    var canvases = Array.prototype.slice.call(document.querySelectorAll("canvas")).filter(visible);
    canvases.sort(function (a, b) {
      var first = a.getBoundingClientRect();
      var second = b.getBoundingClientRect();
      return second.width * second.height - first.width * first.height;
    });
    return canvases[0] || { x: 0.5, y: 0.5 };
  }

  function pointerFor(call, quiet, doing) {
    var pointed = false;
    var tell = function (where, what) {
      var spot = spotOf(where) || spotOf(workspace());
      if (!port || !call || !spot) return;
      pointed = true;
      port.postMessage({ t: "point", call: call, x: spot.x, y: spot.y, doing: typeof what === "string" ? what : undefined });
    };
    var fallback = function () {
      if (!quiet && !pointed) tell(workspace(), doing);
    };
    var timer = setTimeout(fallback, DEFAULT_POINT_MS);
    return {
      point: tell,
      finish: function () {
        clearTimeout(timer);
        fallback();
      },
    };
  }

  function doingOf(name, title) {
    if (typeof title === "string" && title) return title;
    var words = name.replace(/[_.-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function callTool(args) {
    var name = String(args.name || "");
    var input = args.args && typeof args.args === "object" ? args.args : {};
    var agent = args.agent && typeof args.agent.id === "string" ? { id: args.agent.id, name: String(args.agent.name || "Agent") } : null;
    var context = document.modelContext;
    var own = context && typeof context.__mistyTool === "function" ? context.__mistyTool(name) : null;
    var pointer = pointerFor(args.call ? String(args.call) : "", args.quiet === true, doingOf(name, args.title || own && own.title));
    callsRunning++;
    var done = function () {
      callsRunning--;
      pointer.finish();
    };
    if (own) {
      var controller = new AbortController();
      if (args.call) running.set(String(args.call), controller);
      return Promise.resolve()
        .then(function () { return own.execute(input, { signal: controller.signal, agent: agent, point: pointer.point }); })
        .finally(function () {
          if (args.call) running.delete(String(args.call));
          done();
        });
    }
    return Promise.resolve()
      .then(function () { return otherTool(context, name, input, agent, pointer.point); })
      .finally(done);
  }

  function otherTool(context, name, input, agent, point) {
    if (context && typeof context.executeTool === "function" && typeof context.getTools === "function") {
      return Promise.resolve(context.getTools()).then(function (tools) {
        var found = (tools || []).filter(function (tool) { return tool.name === name; })[0];
        if (!found) return adapterCall(name, input, agent, point);
        return context.executeTool(found, input).then(function (text) {
          try {
            return JSON.parse(text);
          } catch (error) {
            return text;
          }
        });
      });
    }
    return adapterCall(name, input, agent, point);
  }

  function adapterCall(name, input, agent, point) {
    var adapter = window.mistyAdapter;
    if (!adapter || typeof adapter.call !== "function") throw new Error("This app has no tool called " + name + ".");
    return adapter.call(name, input, { agent: agent, point: point });
  }

  function holding() {
    return Date.now() < holdUntil;
  }

  function hold(args) {
    if (args.on && !holding()) lastDialog = null;
    holdUntil = args.on ? Date.now() + HOLD_LIMIT : 0;
    agentAt = Date.now();
    return { holding: holding() };
  }

  function state() {
    return { fileChooser: !!chooser, dialog: lastDialog };
  }

  function cancelTool(args) {
    var controller = running.get(String(args.call || ""));
    if (controller) controller.abort(new DOMException("The agent stopped this call.", "AbortError"));
    return { cancelled: !!controller };
  }

  var commands = {
    read: read, look: look, locate: locate, click: click, hover: hover, drag: drag, select: select, fill: fill,
    key: key, type: type, scroll: scroll, wait: wait, upload: upload, dialog: dialog, hold: hold, state: state,
    "tools.list": listTools, "tools.call": callTool, "tools.cancel": cancelTool,
  };

  function personInput(event) {
    if (!event.isTrusted || holding()) return;
    lastInput = Date.now();
    if (!port) return;
    if (lastInput - (personInput.told || 0) < 500) return;
    personInput.told = lastInput;
    port.postMessage({ t: "input" });
  }
  window.addEventListener("pointerdown", personInput, true);
  window.addEventListener("keydown", personInput, true);

  function toolsChanged() {
    if (port) port.postMessage({ t: "tools" });
  }
  if (document.modelContext && typeof document.modelContext.addEventListener === "function") {
    document.modelContext.addEventListener("toolchange", toolsChanged);
  }

  function attach(next) {
    port = next;
    port.onmessage = function (message) {
      var frameIn = message.data;
      if (!frameIn || frameIn.t !== "cmd" || typeof frameIn.id !== "number") return;
      var run = commands[frameIn.name];
      var fail = function (error) {
        port.postMessage({ t: "cmd-res", id: frameIn.id, ok: false, error: String(error && error.message || error) });
      };
      try {
        if (!run) throw new Error("Misty's screen helper doesn't know " + frameIn.name + ".");
        Promise.resolve(run(frameIn.args || {})).then(function (result) {
          port.postMessage({ t: "cmd-res", id: frameIn.id, ok: true, result: result });
        }, fail);
      } catch (error) {
        fail(error);
      }
    };
    toolsChanged();
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.type !== "misty:screen" || !event.ports[0]) return;
    attach(event.ports[0]);
  });
})();
