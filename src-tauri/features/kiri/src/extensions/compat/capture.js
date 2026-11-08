// SPDX-License-Identifier: MIT
// Chrome's tab and screen capture (tabCapture, desktopCapture), which WebKit
// lacks. Both go through WebKit's own screen sharing (getDisplayMedia), so macOS
// asks the person what to share every time; an extension never captures silently.
// Stream ids from these APIs are honored by getUserMedia's Chrome-style
// constraints (chromeMediaSource) in the extension's pages.
(() => {
  "use strict";
  const compat = globalThis.__mistyCompat;
  if (!compat) return;
  const { method, namespace, declared, unsupported } = compat;
  const tab = declared("tabCapture");
  const desktop = declared("desktopCapture");
  if (!tab && !desktop) return;
  const media = globalThis.navigator?.mediaDevices;
  const display = media?.getDisplayMedia ? media.getDisplayMedia.bind(media) : null;
  const unavailable = "Capture needs one of the extension's pages, such as its popup.";
  const share = (audio, video) => {
    if (!display) return Promise.reject(new Error(unavailable));
    return display({ audio: Boolean(audio), video: video === undefined ? true : Boolean(video) });
  };
  const issued = new Set();
  const issue = () => {
    const id = `misty-display-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    issued.add(id);
    return id;
  };

  // getUserMedia({video: {mandatory: {chromeMediaSource: "desktop" | "tab", ...}}}) becomes
  // a screen-sharing request, with or without an id from the APIs below.
  if (media?.getUserMedia && display) {
    const original = media.getUserMedia.bind(media);
    const source = (constraint) =>
      constraint && typeof constraint === "object"
        ? (constraint.mandatory?.chromeMediaSource ?? constraint.chromeMediaSource)
        : undefined;
    media.getUserMedia = (constraints = {}) => {
      const video = source(constraints.video);
      const audio = source(constraints.audio);
      if (!["desktop", "screen", "tab", "window"].includes(video ?? audio)) return original(constraints);
      return share(Boolean(audio), Boolean(constraints.video));
    };
  }

  if (tab)
    namespace("tabCapture", {
      capture: method(({ audio, video } = {}) => share(audio, video)),
      getMediaStreamId: method(() => issue()),
      getCapturedTabs: method(() => []),
      captureOffscreenTab: unsupported("Capturing a page that isn't open is not available in Misty."),
      onStatusChanged: compat.event("tabCapture.onStatusChanged"),
    });

  if (desktop) {
    const pending = new Map();
    namespace("desktopCapture", {
      DesktopCaptureSourceType: { SCREEN: "screen", WINDOW: "window", TAB: "tab", AUDIO: "audio" },
      // The picker itself appears when the stream is requested; the id stands for that choice.
      chooseDesktopMedia: (sources, targetOrCallback, maybeCallback) => {
        const callback = typeof targetOrCallback === "function" ? targetOrCallback : maybeCallback;
        const id = issue();
        const request = pending.size + 1;
        pending.set(request, id);
        setTimeout(() => {
          if (pending.delete(request))
            callback?.(id, { canRequestAudioTrack: Array.isArray(sources) && sources.includes("audio") });
        }, 0);
        return request;
      },
      cancelChooseDesktopMedia: (request) => void pending.delete(request),
    });
  }
})();
