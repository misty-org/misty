// media: reports only changes, after a short settle.
{
  let reported = false;
  let timer = 0;
  const audible = () =>
    Array.from(document.querySelectorAll('audio, video')).some(
      (media) => !media.paused && !media.ended && !media.muted && media.volume > 0,
    );
  const report = (value) => {
    if (value === reported) return;
    reported = value;
    signal('media', 'state', { audible: value });
  };
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => report(audible()), 150);
  };
  // Media events do not bubble, but capturing listeners still see them.
  for (const type of ['play', 'playing', 'pause', 'ended', 'volumechange', 'emptied']) {
    document.addEventListener(type, check, true);
  }
  window.addEventListener('pagehide', () => report(false));
}
