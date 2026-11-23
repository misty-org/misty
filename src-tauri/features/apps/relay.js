(() => {
  "use strict";
  if (window.top !== window) return;
  const token = __MISTY_APP_TOKEN__;
  const bytesPath = __MISTY_APP_BYTES__;
  const tokenHeader = __MISTY_APP_TOKEN_HEADER__;
  const limit = __MISTY_APP_LIMIT__;
  const bind = __KIRI_HOST_SENDER__;
  const world = __MISTY_APP_WORLD__;
  const inline = world ? Infinity : 16384;
  const mark = "$mistyBytes";
  const sdkLane = "misty:init";
  const own = {
    fetch: window.fetch.bind(window),
    post: window.postMessage.bind(window),
    Channel: window.MessageChannel,
    stringify: JSON.stringify,
    parse: JSON.parse,
    timeout: window.setTimeout.bind(window),
    frame: window.requestAnimationFrame.bind(window),
    random: window.crypto.getRandomValues.bind(window.crypto),
    btoa: window.btoa.bind(window),
    atob: window.atob.bind(window),
    tag: Object.prototype.toString,
    has: Object.prototype.hasOwnProperty,
    keys: Object.keys,
    isArray: Array.isArray,
    define: Object.defineProperty,
    Encoder: window.TextEncoder,
    Decoder: window.TextDecoder,
    warn: console.warn.bind(console),
  };
  const newId = () => {
    const bytes = new Uint8Array(16);
    own.random(bytes);
    let text = "";
    for (let index = 0; index < bytes.length; index++) text += (bytes[index] + 256).toString(16).slice(1);
    return text;
  };
  const doc = newId();
  let poster = null;
  const sendText = (text) => {
    poster = poster || bind();
    if (!poster) return false;
    poster(text);
    return true;
  };
  const send = (fields) => sendText(own.stringify(Object.assign({ token: token, doc: doc }, fields)));

  const views = {
    Uint8Array: Uint8Array, Int8Array: Int8Array, Uint8ClampedArray: Uint8ClampedArray,
    Int16Array: Int16Array, Uint16Array: Uint16Array, Int32Array: Int32Array, Uint32Array: Uint32Array,
    Float32Array: Float32Array, Float64Array: Float64Array, DataView: DataView,
  };
  if (typeof BigInt64Array === "function") {
    views.BigInt64Array = BigInt64Array;
    views.BigUint64Array = BigUint64Array;
  }
  const kindOf = (value) => {
    const tag = own.tag.call(value).slice(8, -1);
    return tag === "ArrayBuffer" || own.has.call(views, tag) ? tag : "";
  };
  const bytesOf = (value, kind) =>
    kind === "ArrayBuffer" ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const toBase64 = (bytes) => {
    let text = "";
    for (let at = 0; at < bytes.length; at += 32768)
      text += String.fromCharCode.apply(null, bytes.subarray(at, at + 32768));
    return own.btoa(text);
  };
  const fromBase64 = (text) => {
    const raw = own.atob(text);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
    return bytes;
  };
  const rebuild = (bytes, kind) => {
    const copy = bytes.slice();
    if (kind === "ArrayBuffer") return copy.buffer;
    if (kind === "Uint8Array") return copy;
    const View = views[kind];
    if (!View) throw new Error("Misty sent bytes of a kind the app can't read.");
    if (kind === "DataView") return new DataView(copy.buffer);
    return new View(copy.buffer, 0, copy.byteLength / View.BYTES_PER_ELEMENT);
  };
  const encode = (value, out, depth) => {
    if (depth > 64) throw new Error("That message is nested too deeply to reach Misty.");
    if (value === null || typeof value !== "object") {
      if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol")
        throw new Error("Misty can't take a " + typeof value + " from the app.");
      return value;
    }
    const kind = kindOf(value);
    if (kind) {
      const bytes = bytesOf(value, kind);
      if (bytes.byteLength <= inline) return { [mark]: toBase64(bytes), k: kind };
      const ref = newId();
      out.push({ ref: ref, bytes: bytes });
      return { [mark]: "", r: ref, k: kind };
    }
    if (own.isArray(value)) return value.map((item) => encode(item, out, depth + 1));
    const tag = own.tag.call(value);
    if (tag !== "[object Object]") throw new Error("Misty can't take a " + tag.slice(8, -1) + " from the app.");
    const result = {};
    const names = own.keys(value);
    for (let index = 0; index < names.length; index++) {
      const item = value[names[index]];
      if (item !== undefined) result[names[index]] = encode(item, out, depth + 1);
    }
    return result;
  };
  const decode = async (value, load) => {
    if (value === null || typeof value !== "object") return value;
    if (own.isArray(value)) {
      const list = [];
      for (let index = 0; index < value.length; index++) list.push(await decode(value[index], load));
      return list;
    }
    if (own.has.call(value, mark)) return rebuild(value.r ? await load(value.r) : fromBase64(value[mark]), value.k);
    const result = {};
    const names = own.keys(value);
    for (let index = 0; index < names.length; index++) result[names[index]] = await decode(value[names[index]], load);
    return result;
  };
  const load = (ref) =>
    own.fetch(bytesPath + ref, { headers: { [tokenHeader]: token }, cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("The bytes from Misty didn't arrive.");
      return response.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    });
  const upload = (ref, bytes) =>
    own.fetch(bytesPath + ref, { method: "POST", headers: { [tokenHeader]: token }, body: bytes, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Misty couldn't take the app's bytes.");
      });
  const utf8Length = (text) => (text.length * 3 <= limit ? text.length : new own.Encoder().encode(text).length);

  const readAwareness = (bytes) => {
    let at = 0;
    const varUint = () => {
      let value = 0;
      let scale = 1;
      for (;;) {
        const byte = bytes[at++];
        if (byte === undefined) throw new Error("That presence update is cut short.");
        value += (byte & 127) * scale;
        if (byte < 128) return value;
        scale *= 128;
      }
    };
    const entries = [];
    for (let count = varUint(); count > 0; count--) {
      const client = varUint();
      const clock = varUint();
      const length = varUint();
      if (at + length > bytes.length) throw new Error("That presence update is cut short.");
      entries.push({ client: client, clock: clock, state: bytes.subarray(at, at + length) });
      at += length;
    }
    return entries;
  };
  const writeAwareness = (entries) => {
    const out = [];
    const varUint = (value) => {
      while (value > 127) {
        out.push((value % 128) | 128);
        value = Math.floor(value / 128);
      }
      out.push(value);
    };
    varUint(entries.length);
    entries.forEach((entry) => {
      varUint(entry.client);
      varUint(entry.clock);
      varUint(entry.state.length);
      for (let index = 0; index < entry.state.length; index++) out.push(entry.state[index]);
    });
    return new Uint8Array(out);
  };
  const mergeAwareness = (updates) => {
    const latest = new Map();
    updates.forEach((update) =>
      readAwareness(update).forEach((entry) => {
        const seen = latest.get(entry.client);
        if (!seen || entry.clock >= seen.clock) latest.set(entry.client, entry);
      }),
    );
    return writeAwareness(Array.from(latest.values()));
  };
  const awarenessRoom = (lane, frame) =>
    lane === sdkLane && frame && frame.t === "req" && frame.method === "room.awareness" &&
    frame.params && typeof frame.params.id === "string" && kindOf(frame.params.update)
      ? frame.params.id
      : null;

  const aliases = new Map();
  const coalesce = (batch) => {
    const groups = new Map();
    batch.forEach((item, index) => {
      const room = awarenessRoom(item.lane, item.frame);
      if (room === null) return;
      const group = groups.get(room) || [];
      group.push(index);
      groups.set(room, group);
    });
    const dropped = new Set();
    groups.forEach((indexes) => {
      if (indexes.length < 2) return;
      try {
        const updates = indexes.map((index) => bytesOf(batch[index].frame.params.update, kindOf(batch[index].frame.params.update)));
        const last = batch[indexes[indexes.length - 1]];
        const merged = mergeAwareness(updates);
        const others = indexes.slice(0, -1).map((index) => batch[index].frame.id);
        aliases.set(last.frame.id, others);
        last.frame = Object.assign({}, last.frame, { params: Object.assign({}, last.frame.params, { update: merged }) });
        indexes.slice(0, -1).forEach((index) => dropped.add(index));
      } catch (error) {
        return;
      }
    });
    return batch.filter((_, index) => !dropped.has(index));
  };

  const ports = new Map();
  const deliverLocal = (lane, frame) => {
    const port = ports.get(lane);
    if (!port) return;
    if (lane === sdkLane && frame && frame.t === "res" && aliases.has(frame.id)) {
      const others = aliases.get(frame.id);
      aliases.delete(frame.id);
      others.forEach((id) => port.postMessage(Object.assign({}, frame, { id: id })));
    }
    port.postMessage(frame);
  };
  const refuse = (item, error) => {
    const message = "Misty couldn't take this from the app: " + (error && error.message ? error.message : String(error));
    const frame = item.frame;
    if (item.lane === sdkLane && frame && typeof frame.id === "number") {
      if (frame.t === "req") return deliverLocal(item.lane, { t: "res", id: frame.id, ok: false, error: { code: "internal", message: message } });
      if (frame.t === "sub") return deliverLocal(item.lane, { t: "end", id: frame.id, error: { code: "internal", message: message } });
    }
    own.warn(message);
  };

  let outgoing = [];
  let scheduled = false;
  let sending = Promise.resolve();
  const flush = async (batch) => {
    const ready = [];
    const uploads = [];
    coalesce(batch).forEach((item) => {
      try {
        const out = [];
        const wire = [item.lane, encode(item.frame, out, 0)];
        ready.push({ item: item, wire: wire });
        out.forEach((entry) => uploads.push(upload(entry.ref, entry.bytes)));
      } catch (error) {
        refuse(item, error);
      }
    });
    if (!ready.length) return;
    try {
      await Promise.all(uploads);
      let text = own.stringify({ token: token, doc: doc, frames: ready.map((entry) => entry.wire) });
      if (utf8Length(text) > limit) {
        const ref = newId();
        await upload(ref, new own.Encoder().encode(own.stringify({ frames: ready.map((entry) => entry.wire) })));
        text = own.stringify({ token: token, doc: doc, json: ref });
      }
      if (!sendText(text)) throw new Error("Misty isn't listening.");
    } catch (error) {
      ready.forEach((entry) => refuse(entry.item, error));
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      scheduled = false;
      const batch = outgoing;
      outgoing = [];
      sending = sending.then(() => flush(batch)).catch(() => undefined);
    };
    own.frame(run);
    own.timeout(run, 16);
  };
  const queueOut = (lane, frame) => {
    outgoing.push({ lane: lane, frame: frame });
    schedule();
  };

  const waiting = new Map();
  const handed = new Map();
  const handOver = (lane, port, message) => {
    handed.set(lane, { port: port, message: message });
    const waiters = waiting.get(lane) || [];
    waiting.delete(lane);
    waiters.forEach((resolve) => resolve(handed.get(lane)));
    if (lane === "misty:screen" && typeof window.__mistyScreenAttach === "function") window.__mistyScreenAttach(port);
  };
  const portFor = (lane) =>
    new Promise((resolve) => {
      const ready = handed.get(lane);
      if (ready) {
        handed.delete(lane);
        return resolve(ready);
      }
      waiting.set(lane, (waiting.get(lane) || []).concat([(found) => {
        handed.delete(lane);
        resolve(found);
      }]));
    });
  if (world)
    own.define(window, "mistyAdapterHost", {
      value: Object.freeze({
        connect: () =>
          portFor(sdkLane).then((found) => {
            const SDK = window.MistySDK;
            if (!SDK || typeof SDK.createMisty !== "function" || typeof SDK.Connection !== "function")
              throw new Error("Misty's SDK isn't loaded in this adapter.");
            const protocol = typeof found.message.version === "number" ? found.message.version : 1;
            return new SDK.Connection(found.port)
              .call("hello", { sdk: "adapter", protocol: protocol })
              .then((hello) => SDK.createMisty(found.port, hello));
          }),
      }),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  const start = (lane, message) => {
    if (typeof lane !== "string" || !message || typeof message !== "object") return;
    const old = ports.get(lane);
    if (old) {
      old.onmessage = null;
      old.close();
    }
    const channel = new own.Channel();
    ports.set(lane, channel.port1);
    channel.port1.onmessage = (event) => queueOut(lane, event.data);
    if (world) return handOver(lane, channel.port2, message);
    own.post(Object.assign({}, message, { type: lane }), "*", [channel.port2]);
  };
  const stop = (lane) => {
    const port = ports.get(lane);
    if (!port) return;
    ports.delete(lane);
    port.onmessage = null;
    port.close();
  };
  const unreachable = (lane, wire, error) => {
    const message = "Misty's message didn't reach the app: " + (error && error.message ? error.message : String(error));
    if (!wire || typeof wire.id !== "number") return own.warn(message);
    if (lane === sdkLane && wire.t === "res")
      return deliverLocal(lane, { t: "res", id: wire.id, ok: false, error: { code: "internal", message: message } });
    if (lane === sdkLane && wire.t === "evt") {
      deliverLocal(lane, { t: "end", id: wire.id, error: { code: "internal", message: message } });
      return queueOut(lane, { t: "unsub", id: wire.id });
    }
    if (wire.t === "cmd") return queueOut(lane, { t: "cmd-res", id: wire.id, ok: false, error: message });
    own.warn(message);
  };
  const take = async (message) => {
    if (!message || typeof message !== "object") return;
    if (typeof message.json === "string") {
      let parsed;
      try {
        parsed = own.parse(new own.Decoder().decode(await load(message.json)));
      } catch (error) {
        return own.warn("Misty's message didn't reach the app: " + error.message);
      }
      return take(parsed);
    }
    if (message.start) return start(message.start.lane, message.start.message);
    if (typeof message.stop === "string") return stop(message.stop);
    if (!own.isArray(message.frames)) return;
    for (let index = 0; index < message.frames.length; index++) {
      const entry = message.frames[index];
      if (!own.isArray(entry) || typeof entry[0] !== "string") continue;
      const lane = entry[0];
      if (!ports.has(lane)) continue;
      try {
        deliverLocal(lane, await decode(entry[1], load));
      } catch (error) {
        unreachable(lane, entry[1], error);
      }
    }
  };
  let incoming = Promise.resolve();
  own.define(window, "__mistyAppRelay", {
    value: (message) => {
      incoming = incoming.then(() => take(message)).catch(() => undefined);
    },
    writable: false,
    configurable: false,
    enumerable: false,
  });

  let shortcuts = new Map();
  const setShortcuts = (bindings) => {
    shortcuts = new Map((own.isArray(bindings) ? bindings : [])
      .filter((binding) => binding && typeof binding.shortcut === "string")
      .map((binding) => [binding.shortcut, Boolean(binding.allowInEditable)]));
  };
  setShortcuts(__MISTY_APP_SHORTCUTS__);
  own.define(window, "__MISTY_SET_SHORTCUTS__", { value: setShortcuts, writable: false, configurable: false, enumerable: false });
  const named = {
    Backquote: "Grave", Backslash: "Backslash", BracketLeft: "LeftBracket", BracketRight: "RightBracket",
    Comma: "Comma", Period: "Period", Equal: "Plus", Minus: "Minus", NumpadAdd: "Plus", NumpadSubtract: "Minus",
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    PageUp: "PageUp", PageDown: "PageDown", Escape: "Escape", Esc: "Escape", Enter: "Enter", Tab: "Tab",
    Backspace: "Backspace",
  };
  const shortcutOf = (event) => {
    let key = event.code;
    if (/^Key[A-Z]$/i.test(key)) key = key.slice(3).toUpperCase();
    else if (/^Digit[0-9]$/.test(key)) key = key.slice(5);
    else key = named[key] || (event.key && event.key.length === 1 ? event.key.toUpperCase() : event.key);
    return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && key !== "Plus" && "Shift",
      event.metaKey && "Cmd", key].filter(Boolean).join("+");
  };
  window.addEventListener("keydown", (event) => {
    if (!event.isTrusted) return;
    const allowInEditable = shortcuts.get(shortcutOf(event));
    if (allowInEditable === undefined) return;
    const target = event.target;
    const editable = Boolean(target && target.closest &&
      target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
    if (editable && !allowInEditable) return;
    send({ shortcut: {
      key: String(event.key), code: String(event.code), alt: event.altKey, ctrl: event.ctrlKey,
      meta: event.metaKey, shift: event.shiftKey, repeat: event.repeat, editable: editable,
    } });
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("pointerdown", (event) => {
    if (event.isTrusted) send({ focus: true });
  }, true);

  send({ open: true });
  const announce = () => send({ ready: true });
  if (document.readyState === "complete") own.timeout(announce, 0);
  else window.addEventListener("load", announce, { once: true });
})();
