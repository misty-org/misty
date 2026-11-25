(() => {
  if (window !== window.top || window.__mistyMedia) return;
  const channel = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mistyMedia;
  if (!channel || typeof channel.postMessage !== 'function') return;
  const post = channel.postMessage.bind(channel);
  const actions = new Map();
  const tracked = new Set();
  const events = ['play', 'playing', 'pause', 'ended', 'seeked', 'durationchange', 'loadedmetadata',
    'emptied', 'ratechange', 'volumechange'];
  const shortest = 10;
  let chosen = null;
  let timer = 0;
  let sent = '';

  const audible = (m) => !m.muted && m.volume > 0;
  const live = (m) => !m.paused && !m.ended;
  const long = (m) => !(Number.isFinite(m.duration) && m.duration < shortest);
  const finite = (n) => (Number.isFinite(n) && n >= 0 ? n : null);
  const text = (value, most) => String(value || '').trim().slice(0, most);

  const size = (art) =>
    Math.max(0, ...String(art.sizes || '').split(/\s+/).map((part) => parseInt(part, 10) || 0));
  const artwork = (meta) => {
    const pictures = Array.from((meta && meta.artwork) || [])
      .filter((art) => /^https:\/\//.test(String(art.src || '')))
      .sort((a, b) => size(b) - size(a));
    const pick = pictures.find((art) => size(art) <= 512) || pictures[pictures.length - 1];
    if (pick) return String(pick.src);
    const og = document.querySelector('meta[property="og:image"]');
    const image = og ? String(og.content || '') : '';
    return /^https:\/\//.test(image) ? image : '';
  };

  const snapshot = () => {
    const m = chosen;
    const session = navigator.mediaSession;
    const meta = session && session.metadata;
    const picture = artwork(meta);
    return {
      active: Boolean(m),
      playing: Boolean(m && live(m)),
      title: text((meta && meta.title) || document.title, 200),
      artist: text(meta && meta.artist, 200),
      album: text(meta && meta.album, 200),
      artwork: picture.length <= 2048 ? picture : '',
      duration: m ? finite(m.duration) : null,
      position: m ? finite(m.currentTime) : null,
      canPrevious: actions.has('previoustrack'),
      canNext: actions.has('nexttrack'),
      canSeek: Boolean(m && Number.isFinite(m.duration) && m.duration > 0),
    };
  };

  const report = () => {
    timer = 0;
    if (chosen && (chosen.ended || chosen.readyState === 0) && !live(chosen)) {
      const candidate = Array.from(tracked).find((m) => live(m) && audible(m) && long(m));
      chosen = candidate || null;
    }
    const body = JSON.stringify(snapshot());
    if (body === sent) return;
    sent = body;
    post(body);
  };

  const schedule = (wait) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(report, wait || 80);
  };

  const heard = (event) => {
    const m = event.target;
    if (live(m) && audible(m) && long(m)) chosen = m;
    else if (m === chosen && !long(m)) chosen = null;
    schedule(m === chosen && (event.type === 'ended' || event.type === 'emptied') ? 1500 : 80);
  };

  const watch = (m) => {
    if (tracked.has(m)) return;
    tracked.add(m);
    events.forEach((name) => m.addEventListener(name, heard));
  };

  events.forEach((name) => {
    document.addEventListener(name, (event) => {
      const target = event.target;
      if (target instanceof HTMLMediaElement) watch(target);
    }, true);
  });

  try {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      watch(this);
      return play.apply(this, arguments);
    };
  } catch (_) {}

  try {
    const session = navigator.mediaSession;
    if (session) {
      const set = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => {
        if (typeof handler === 'function') actions.set(action, handler);
        else actions.delete(action);
        schedule();
        return set(action, handler);
      };
      const prototype = Object.getPrototypeOf(session);
      const metadata = prototype && Object.getOwnPropertyDescriptor(prototype, 'metadata');
      if (metadata && metadata.get && metadata.set) {
        Object.defineProperty(session, 'metadata', {
          configurable: true,
          get() { return metadata.get.call(this); },
          set(value) { metadata.set.call(this, value); schedule(); },
        });
      }
    }
  } catch (_) {}

  const act = (action, position) => {
    const handler = actions.get(action);
    if (handler) {
      try {
        handler({ action, seekTime: position === null ? undefined : position });
        return;
      } catch (_) {}
    }
    const m = chosen;
    if (!m) return;
    if (action === 'play') m.play().catch(() => {});
    else if (action === 'pause') m.pause();
    else if (action === 'seekto' && position !== null) m.currentTime = position;
  };

  Object.defineProperty(window, '__mistyMedia', {
    value: Object.freeze({ act }),
    enumerable: false,
    writable: false,
    configurable: false,
  });

  window.addEventListener('pagehide', () => {
    chosen = null;
    if (timer) clearTimeout(timer);
    timer = 0;
    sent = '';
    post(JSON.stringify(snapshot()));
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) schedule();
  });
})();
