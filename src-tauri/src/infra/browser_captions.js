// What the video in this frame is saying, for questions at the cursor (browser_media_session.rs).
// It runs in every frame, because course videos (Canvas Studio, Kaltura, Panopto, YouTube
// embeds) play inside frames from other sites. Each frame keeps its own video's captions,
// read three ways and all before a question so that a question never waits on them:
//   1. the video's own text tracks, a disabled caption track set to "hidden" so its cues load
//      without being shown;
//   2. a YouTube video's caption track, fetched once as it starts playing, as YouTube's own
//      player would;
//   3. caption files the page itself downloaded (WebVTT, SRT, TTML/DFXP, JSON), read from the
//      responses as they arrive. Nothing is fetched again or with other credentials.
// A frame whose video plays tells the top document over postMessage; the top keeps the
// latest word from each frame and answers `__mistyFramedMedia`. Messages carry no token:
// what they hold is the page's own text, trusted no more than the page.
const MARK = '__mistyFrameMedia';
if (window.__mistyFrameMedia) return;
const isTop = window === window.top;
const topWindow = window.top;
// The page's own fetch, before the tap below wraps it.
const pageFetch = window.fetch;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const finiteOr = (n, fallback) => (Number.isFinite(n) ? n : fallback);

// The element playing in this frame, as the media card picks it.
let lastPlayed = null;
const playingElement = () => {
  const media = Array.from(document.querySelectorAll('video, audio'));
  if (lastPlayed && lastPlayed.isConnected && !media.includes(lastPlayed)) media.push(lastPlayed);
  return (
    media.find((m) => !m.paused && !m.ended) ||
    media.find((m) => m.dataset && m.dataset.mistyPaused === '1') ||
    media.filter((m) => m.currentTime > 0).sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] ||
    null
  );
};

// 1. Text tracks. The track the person sees comes first, then the page's language, then English.
const language = () => String(document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase();
const trackCues = new WeakMap();
const captionTrack = (video) => {
  const tracks = Array.from((video && video.textTracks) || [])
    .filter((track) => track.kind === 'captions' || track.kind === 'subtitles');
  if (!tracks.length) return null;
  const lang = (track) => String(track.language || '').toLowerCase();
  const want = language();
  return (
    tracks.find((track) => track.mode === 'showing') ||
    tracks.find((track) => track.mode === 'hidden' && lang(track).startsWith(want)) ||
    tracks.find((track) => lang(track).startsWith(want)) ||
    tracks.find((track) => lang(track).startsWith('en')) ||
    tracks[0]
  );
};
const readTrack = (track) => {
  try {
    const cues = track.cues;
    if (cues && cues.length) {
      trackCues.set(track, Array.from(cues)
        .slice(0, mistyCaptions.MAX_CUES)
        .map((cue) => [cue.startTime, mistyCaptions.clean(cue.text)])
        .filter((cue) => Number.isFinite(cue[0]) && cue[1]));
    }
  } catch (_) {}
  return trackCues.get(track) || null;
};
// Loads a disabled track's cues without showing them; a track the page shows stays as it is.
const prepareTracks = (video) => {
  const track = captionTrack(video);
  if (!track) return;
  try { if (track.mode === 'disabled') track.mode = 'hidden'; } catch (_) {}
  readTrack(track);
};

// 2. YouTube, on its own pages and in its embeds.
const youtube = { id: '', events: null, pending: false };
const youtubeVideoId = () => {
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return '';
  const embed = /^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(location.pathname);
  return (embed && embed[1]) || new URLSearchParams(location.search).get('v') || '';
};
const youtubeResponse = (id) => {
  const player = document.getElementById('movie_player');
  const candidates = [];
  try { if (player && typeof player.getPlayerResponse === 'function') candidates.push(player.getPlayerResponse()); } catch (_) {}
  candidates.push(window.ytInitialPlayerResponse);
  try {
    const vars = window.ytcfg && typeof window.ytcfg.get === 'function' && window.ytcfg.get('PLAYER_VARS');
    const embedded = vars && vars.embedded_player_response;
    if (embedded) candidates.push(typeof embedded === 'string' ? JSON.parse(embedded) : embedded);
  } catch (_) {}
  return candidates.find((response) => response && response.videoDetails && response.videoDetails.videoId === id);
};
const prefetchYoutube = () => {
  const id = youtubeVideoId();
  if (!id || youtube.pending || youtube.id === id) return;
  try {
    const response = youtubeResponse(id);
    if (!response) return;
    const list = response.captions && response.captions.playerCaptionsTracklistRenderer;
    const tracks = (list && list.captionTracks) || [];
    const want = language();
    const has = (track, lang) => String(track.languageCode || '').startsWith(lang);
    const track =
      tracks.find((t) => has(t, want) && t.kind !== 'asr') ||
      tracks.find((t) => has(t, want)) ||
      tracks.find((t) => has(t, 'en')) ||
      tracks[0];
    youtube.id = id;
    youtube.events = null;
    if (!track || !track.baseUrl) return;
    const url = new URL(track.baseUrl, location.origin);
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return;
    url.searchParams.set('fmt', 'json3');
    youtube.pending = true;
    // Same-origin credentials: what the page sends itself, and nothing from a nocookie embed.
    pageFetch.call(window, url.href, { credentials: 'same-origin' })
      .then((reply) => (reply.ok ? reply.json() : null))
      .then((json) => {
        if (youtube.id !== id || !json) return;
        youtube.events = mistyCaptions.json(json);
        scheduleReport(50);
      })
      .catch(() => {})
      .finally(() => { youtube.pending = false; });
  } catch (_) {
    youtube.pending = false;
  }
};

// 3. Caption files the page downloads. Kept per file (HLS segments of one track count as one
// file), and the one downloaded last is the track the player is on.
const captured = new Map();
const captureGroup = (url) => {
  const bare = String(url || '').split(/[?#]/)[0];
  const slash = bare.lastIndexOf('/');
  return bare.slice(0, slash + 1) + bare.slice(slash + 1).replace(/\d+/g, '#');
};
const capture = (url, body) => {
  try {
    if (typeof body === 'string' && body.length > 5000000) return;
    const cues = mistyCaptions.parse(body, url);
    if (!cues.length) return;
    const group = captureGroup(url);
    const entry = captured.get(group) || { cues: [], at: 0 };
    entry.cues = mistyCaptions.whole(url) ? cues : mistyCaptions.merge(entry.cues, cues);
    entry.at = now();
    captured.delete(group);
    captured.set(group, entry);
    while (captured.size > 8) captured.delete(captured.keys().next().value);
    scheduleReport(50);
  } catch (_) {}
};
const latestCaptured = () => {
  let latest = null;
  for (const entry of captured.values()) if (!latest || entry.at >= latest.at) latest = entry;
  return latest ? latest.cues : null;
};
try {
  const nativeFetch = pageFetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function fetch(input) {
      const result = nativeFetch.apply(this, arguments);
      try {
        // Attached before the page's own handlers, so the body is still unread when cloned.
        result.then((response) => {
          try {
            if (!response || !response.ok || response.type === 'opaque') return;
            const url = response.url || (typeof input === 'string' ? input : (input && input.url) || '');
            if (!mistyCaptions.looksLikeCaptions(url, response.headers.get('content-type'))) return;
            response.clone().text().then((text) => capture(url, text), () => {});
          } catch (_) {}
        }, () => {});
      } catch (_) {}
      return result;
    };
  }
} catch (_) {}
try {
  const Request = window.XMLHttpRequest;
  const pageOpen = Request && Request.prototype.open;
  if (typeof pageOpen === 'function') {
    const addresses = new WeakMap();
    const loaded = function () {
      try {
        const url = this.responseURL || addresses.get(this) || '';
        if (this.status < 200 || this.status >= 300) return;
        if (!mistyCaptions.looksLikeCaptions(url, this.getResponseHeader('content-type'))) return;
        const kind = this.responseType;
        if (kind === '' || kind === 'text') capture(url, this.responseText);
        else if (kind === 'json') capture(url, this.response);
        else if (kind === 'arraybuffer' && this.response && typeof TextDecoder === 'function')
          capture(url, new TextDecoder().decode(this.response));
      } catch (_) {}
    };
    Request.prototype.open = function open(method, url) {
      try {
        if (!addresses.has(this)) this.addEventListener('load', loaded);
        addresses.set(this, String(url || ''));
      } catch (_) {}
      return pageOpen.apply(this, arguments);
    };
  }
} catch (_) {}

const captionsFor = (element) => {
  if (element && element.tagName === 'VIDEO') {
    const track = captionTrack(element);
    const cues = track && readTrack(track);
    if (cues && cues.length) return cues;
  }
  const id = youtubeVideoId();
  if (id && youtube.id === id && youtube.events && youtube.events.length) return youtube.events;
  return latestCaptured();
};

// This frame's video and what it has said, or nothing when it plays nothing.
const frameMedia = () => {
  const element = playingElement();
  if (!element) return null;
  return {
    title: String(document.title || '').slice(0, 200),
    url: String(location.href).slice(0, 2048),
    time: finiteOr(element.currentTime, null),
    duration: finiteOr(element.duration, null),
    paused: Boolean(element.paused),
    rate: finiteOr(element.playbackRate, 1),
    hasMedia: Boolean(!element.ended && (element.currentTime > 0 || !element.paused)),
    captions: captionsFor(element),
  };
};
Object.defineProperty(window, '__mistyFrameMedia', { value: frameMedia });

// A frame tells the top document about its video: often while it plays (the time), and its
// captions whenever they change, at most every ten seconds once some have been sent.
let reportTimer = 0;
let playingTimer = 0;
let sentCaptions = '';
let sentCaptionsAt = 0;
const report = () => {
  reportTimer = 0;
  if (isTop) return;
  const media = frameMedia();
  const message = { [MARK]: 1, gone: !media };
  if (media) {
    const { captions, ...rest } = media;
    Object.assign(message, rest);
    const count = captions ? captions.length : 0;
    const signature = count + ':' + (count ? captions[count - 1][0] : '');
    if (signature !== sentCaptions && (!sentCaptions || sentCaptions[0] === '0' || now() - sentCaptionsAt > 10000 || media.paused)) {
      message.captions = captions || null;
      sentCaptions = signature;
      sentCaptionsAt = now();
    }
  }
  try { topWindow.postMessage(message, '*'); } catch (_) {}
};
function scheduleReport(delay) {
  if (isTop || reportTimer) return;
  reportTimer = setTimeout(report, delay);
}
const onMedia = (event) => {
  const target = event.target;
  if (!target || (target.tagName !== 'VIDEO' && target.tagName !== 'AUDIO')) return;
  if (event.type === 'play' || event.type === 'playing') {
    lastPlayed = target;
    if (target.tagName === 'VIDEO') prepareTracks(target);
    prefetchYoutube();
    if (!isTop && !playingTimer) playingTimer = setInterval(() => {
      const element = playingElement();
      if (!element || element.paused) { clearInterval(playingTimer); playingTimer = 0; }
      scheduleReport(0);
    }, 2000);
  }
  scheduleReport(100);
};
['play', 'playing', 'pause', 'ended', 'seeked', 'ratechange', 'durationchange', 'loadedmetadata', 'emptied']
  .forEach((name) => document.addEventListener(name, onMedia, true));
// A track that arrives or finishes loading after play (a <track> element, or one the player adds).
document.addEventListener('load', (event) => {
  if (event.target && event.target.tagName === 'TRACK') scheduleReport(50);
}, true);
window.addEventListener('pagehide', () => {
  if (isTop) return;
  try { topWindow.postMessage({ [MARK]: 1, gone: true }, '*'); } catch (_) {}
});

// The top document: the latest word from each frame below it.
if (isTop) {
  const reports = new Map();
  const below = (source) => {
    const queue = [window];
    for (let seen = 0; queue.length && seen < 200; seen += 1) {
      const frame = queue.shift();
      try {
        for (let i = 0; i < frame.frames.length; i += 1) {
          if (frame.frames[i] === source) return true;
          queue.push(frame.frames[i]);
        }
      } catch (_) {}
    }
    return false;
  };
  // Registered before any page script, so it runs first and the page never sees these.
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data[MARK] !== 1) return;
    event.stopImmediatePropagation();
    const source = event.source;
    if (!source || source === window || !below(source)) return;
    if (data.gone) { reports.delete(source); return; }
    const previous = reports.get(source);
    reports.set(source, {
      title: String(data.title || '').slice(0, 200),
      url: String(data.url || '').slice(0, 2048),
      time: finiteOr(data.time, null),
      duration: finiteOr(data.duration, null),
      paused: data.paused !== false,
      rate: finiteOr(data.rate, 1),
      hasMedia: data.hasMedia === true,
      captions: 'captions' in data
        ? (Array.isArray(data.captions) ? data.captions.slice(0, mistyCaptions.MAX_CUES) : null)
        : (previous ? previous.captions : null),
      at: now(),
    });
  }, true);
  // The frame playing now, or the one heard from last; its time carried forward to this moment.
  Object.defineProperty(window, '__mistyFramedMedia', {
    value: () => {
      let best = null;
      for (const [source, entry] of reports) {
        if (source.closed) { reports.delete(source); continue; }
        if (!entry.hasMedia) continue;
        if (!best || (best.paused && !entry.paused) || (best.paused === entry.paused && entry.at > best.at)) best = entry;
      }
      if (!best) return null;
      let time = best.time;
      if (time !== null && !best.paused) {
        time += ((now() - best.at) / 1000) * best.rate;
        if (best.duration) time = Math.min(time, best.duration);
      }
      return { ...best, time };
    },
  });
}
