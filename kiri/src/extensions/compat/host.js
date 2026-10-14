// SPDX-License-Identifier: MIT
// Hidden page in the extension's origin. It relays compatibility requests from
// the extension's background and pages to Misty, and Misty's events back.
"use strict";
const channel = new BroadcastChannel("misty-compat");
// Kiri's extension transport (kiri/src/extensions/bridge.rs).
const native = window.webkit.messageHandlers.kiriExtension;

const voices = () =>
  speechSynthesis.getVoices().map((voice) => ({
    voiceName: voice.name,
    lang: voice.lang,
    remote: !voice.localService,
    eventTypes: ["start", "end", "interrupted", "cancelled", "error"],
  }));

/** Speech uses WebKit's own synthesizer once Misty confirms the permission. */
async function speech(method, args) {
  await native.postMessage({ method: "tts.allowed", args: [] });
  const [text, options = {}] = args;
  switch (method) {
    case "tts.speak": {
      if (!options.enqueue) speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(text ?? "").slice(0, 32768));
      if (typeof options.lang === "string") utterance.lang = options.lang;
      if (typeof options.voiceName === "string")
        utterance.voice = speechSynthesis.getVoices().find((v) => v.name === options.voiceName) ?? null;
      for (const key of ["rate", "pitch", "volume"])
        if (typeof options[key] === "number") utterance[key] = options[key];
      speechSynthesis.speak(utterance);
      return null;
    }
    case "tts.stop":
      speechSynthesis.cancel();
      return null;
    case "tts.pause":
      speechSynthesis.pause();
      return null;
    case "tts.resume":
      speechSynthesis.resume();
      return null;
    case "tts.isSpeaking":
      return speechSynthesis.speaking;
    case "tts.getVoices":
      return voices();
    default:
      throw new Error("Unknown speech request.");
  }
}

/** Chrome's offscreen document: one hidden frame in this page, in the extension's origin. */
let offscreen = null;
async function offscreenDocument(method, args) {
  switch (method) {
    case "offscreen.create": {
      if (offscreen) throw new Error("Only a single offscreen document may be created.");
      const target = new URL(String(args[0] ?? ""), location.href);
      if (target.origin !== location.origin)
        throw new Error("An offscreen document must be one of the extension's own pages.");
      const frame = document.createElement("iframe");
      frame.src = target.href;
      offscreen = frame;
      const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
      document.documentElement.appendChild(frame);
      await loaded;
      return null;
    }
    case "offscreen.close":
      if (!offscreen) throw new Error("No offscreen document exists.");
      offscreen.remove();
      offscreen = null;
      return null;
    case "offscreen.has":
      return Boolean(offscreen);
    case "offscreen.get":
      return offscreen ? offscreen.src : null;
    default:
      throw new Error("Unknown offscreen request.");
  }
}

channel.onmessage = async ({ data }) => {
  if (!data || typeof data !== "object") return;
  if (data.hello) {
    channel.postMessage({ ready: true });
    return;
  }
  if (typeof data.request !== "string" || typeof data.method !== "string") return;
  const args = Array.isArray(data.args) ? data.args : [];
  try {
    const result = data.method.startsWith("tts.")
      ? await speech(data.method, args)
      : data.method.startsWith("offscreen.")
        ? await offscreenDocument(data.method, args)
        : await native.postMessage({ method: data.method, args });
    channel.postMessage({ reply: data.request, result: result ?? null });
  } catch (error) {
    channel.postMessage({ reply: data.request, error: String(error?.message ?? error) });
  }
};

/** Misty calls this to deliver an extension event to every open page. */
window.mistyCompatEvent = (event, args) => channel.postMessage({ event, args });
speechSynthesis.onvoiceschanged = () => window.mistyCompatEvent("tts.onVoicesChanged", []);
channel.postMessage({ ready: true });
