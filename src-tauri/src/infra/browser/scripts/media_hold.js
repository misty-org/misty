// A page another computer opened, on a computer nobody is looking at, plays nothing. While held,
// starting media is refused the way a browser refuses autoplay, which sites already handle by
// showing their play button. Nothing resumes on release: the person starts it when they want it.
(() => {
  if (window.__MISTY_HOLD_MEDIA__) return;
  const realPlay = HTMLMediaElement.prototype.play;
  const realResume = window.AudioContext && window.AudioContext.prototype.resume;
  let held = false;
  const refused = () =>
    Promise.reject(new DOMException('Playback waits until this tab is opened.', 'NotAllowedError'));

  HTMLMediaElement.prototype.play = function play() {
    return held ? refused() : realPlay.apply(this, arguments);
  };
  if (realResume) {
    window.AudioContext.prototype.resume = function resume() {
      return held ? refused() : realResume.apply(this, arguments);
    };
  }
  // The `autoplay` attribute starts media without calling play().
  window.addEventListener(
    'play',
    (event) => {
      if (held && event.target instanceof HTMLMediaElement) event.target.pause();
    },
    true,
  );

  const apply = (state) => {
    held = Boolean(state);
    if (held) {
      for (const media of document.querySelectorAll('video,audio')) {
        if (!media.paused) media.pause();
      }
    }
    for (let index = 0; index < window.frames.length; index++) {
      try { window.frames[index].postMessage({ __mistyHoldMedia: held }, '*'); } catch {}
    }
  };
  // Frames follow the page that holds them.
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || typeof event.data?.__mistyHoldMedia !== 'boolean') return;
    apply(event.data.__mistyHoldMedia);
  });
  window.__MISTY_HOLD_MEDIA__ = apply;
})();
