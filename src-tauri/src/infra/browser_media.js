// Reports whether the page is audibly playing media, so Misty can show a
// speaker on the tab. Reports only changes, after a short settle.
(() => {
  if (window.top !== window || window.__MISTY_MEDIA__) return;
  window.__MISTY_MEDIA__ = true;
  let reported = false;
  let timer = 0;
  const audible = () =>
    Array.from(document.querySelectorAll("audio, video")).some(
      (media) => !media.paused && !media.ended && !media.muted && media.volume > 0,
    );
  const report = (value) => {
    if (value === reported) return;
    reported = value;
    window.location.href = `misty-media:state?audible=${value ? 1 : 0}`;
  };
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => report(audible()), 150);
  };
  // Media events do not bubble, but capturing listeners still see them.
  for (const type of ["play", "playing", "pause", "ended", "volumechange", "emptied"]) {
    document.addEventListener(type, check, true);
  }
  window.addEventListener("pagehide", () => report(false));
})();
