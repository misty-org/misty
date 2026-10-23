// A hidden tab on Windows stays in place beneath Misty's renderer, so the
// engine still thinks it is on screen and keeps drawing it. After a minute the
// host asks the page to behave as a background tab does: it reads as hidden,
// its animation frames and CSS animations wait, and muted videos pause. Showing
// the tab undoes it at once; its last frame never left the screen.
(() => {
  if (window.__MISTY_SET_BACKGROUNDED__) return;
  const realRequestFrame = window.requestAnimationFrame.bind(window);
  const realCancelFrame = window.cancelAnimationFrame.bind(window);
  const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const hiddenProperty = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  const waiting = new Map();
  const pausedVideos = new Set();
  const captures = new Set();
  let nextWaitingId = -1;
  let backgrounded = false;
  let pauseStyle = null;

  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!backgrounded) return realRequestFrame(callback);
    const id = nextWaitingId--;
    waiting.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    if (!waiting.delete(id)) realCancelFrame(id);
  };
  if (visibility?.get && hiddenProperty?.get) {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      enumerable: true,
      get() { return backgrounded ? 'hidden' : visibility.get.call(this); },
    });
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      enumerable: true,
      get() { return backgrounded || hiddenProperty.get.call(this); },
    });
  }

  // Calls and screen shares keep their tab running.
  const media = navigator.mediaDevices;
  for (const name of ['getUserMedia', 'getDisplayMedia']) {
    const original = media?.[name]?.bind(media);
    if (!original) continue;
    media[name] = (...args) => original(...args).then((stream) => {
      captures.add(stream);
      return stream;
    });
  }
  const capturing = () => {
    for (const stream of captures) {
      if (stream.getTracks().some((track) => track.readyState === 'live')) return true;
      captures.delete(stream);
    }
    return false;
  };
  // Sound, picture in picture and capture keep a tab running.
  const exempt = () =>
    capturing() ||
    Boolean(document.pictureInPictureElement) ||
    Array.from(document.querySelectorAll('video,audio')).some(
      (element) => !element.paused && !element.muted && element.volume > 0,
    );

  const toFrames = (state) => {
    for (let index = 0; index < window.frames.length; index++) {
      try { window.frames[index].postMessage({ __mistyBackgrounded: state }, '*'); } catch {}
    }
  };

  const apply = (state) => {
    if (state && exempt()) state = false;
    if (state === backgrounded) return backgrounded;
    backgrounded = state;
    if (state) {
      pauseStyle = document.createElement('style');
      pauseStyle.textContent = '*,*::before,*::after{animation-play-state:paused!important}';
      (document.head || document.documentElement).appendChild(pauseStyle);
      for (const video of document.querySelectorAll('video')) {
        if (!video.paused && (video.muted || video.volume === 0)) {
          video.pause();
          pausedVideos.add(video);
        }
      }
    } else {
      pauseStyle?.remove();
      pauseStyle = null;
      for (const video of pausedVideos) video.play().catch(() => {});
      pausedVideos.clear();
      const callbacks = Array.from(waiting.values());
      waiting.clear();
      for (const callback of callbacks) realRequestFrame(callback);
    }
    document.dispatchEvent(new Event('visibilitychange'));
    toFrames(state);
    return backgrounded;
  };

  // Frames follow the page that holds them.
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || typeof event.data?.__mistyBackgrounded !== 'boolean') return;
    apply(event.data.__mistyBackgrounded);
  });
  // The host's switch; returns whether the page is now backgrounded.
  window.__MISTY_SET_BACKGROUNDED__ = (state) => apply(Boolean(state));
})();
