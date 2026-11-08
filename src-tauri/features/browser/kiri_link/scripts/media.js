  // What the page is playing, in one place: the snapshot the media card reads on request, and the
  // one pushed to the host the moment anything about it changes (play, pause, seek, a new track,
  // picture in picture), so the card never waits on a timer.
  const mediaSnapshot = () => {
    const nav = window.navigator;
    const media = Array.from(document.querySelectorAll('video, audio'));
    const element =
      media.find((m) => !m.paused && !m.ended) ||
      media.find((m) => m.dataset && m.dataset.mistyPaused === '1') ||
      media.filter((m) => m.currentTime > 0).sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
    const meta = nav && nav.mediaSession && nav.mediaSession.metadata;
    const size = (art) => Math.max(...String(art.sizes || '0x0').split(/\s+/).map((v) => parseInt(v, 10) || 0));
    const art = Array.from((meta && meta.artwork) || [])
      .filter((a) => /^https:/.test(a.src || ''))
      .sort((a, b) => size(b) - size(a));
    const pick = art.find((a) => size(a) <= 512) || art[art.length - 1];
    const og = document.querySelector('meta[property="og:image"]');
    const ogImage = og && /^https:/.test(og.content || '') ? og.content : '';
    const actions = window.__mistyMediaActions;
    const finite = (n) => (Number.isFinite(n) ? n : null);
    const text = (v, max) => String(v || '').slice(0, max);
    const artwork = text((pick && pick.src) || ogImage, 600);
    return {
      title: text(meta && meta.title, 200),
      artist: text(meta && meta.artist, 200),
      artwork: artwork.length >= 600 ? '' : artwork,
      duration: element ? finite(element.duration) : null,
      position: element ? finite(element.currentTime) : null,
      paused: element ? element.paused : Boolean(nav && nav.mediaSession && nav.mediaSession.playbackState === 'paused'),
      // A media session is alive: something has played and has not ended, even if it is paused now.
      hasMedia: Boolean(element && !element.ended && (element.currentTime > 0 || !element.paused)),
      canPrevious: Boolean(actions && actions.has('previoustrack')),
      canNext: Boolean(actions && actions.has('nexttrack')),
      pictureInPicture: Boolean(
        document.pictureInPictureElement ||
        media.some((m) => m.webkitPresentationMode === 'picture-in-picture')
      ),
    };
  };
  window.__mistyMediaSnapshot = mediaSnapshot;

  // What a video has said, for questions at the cursor (browser/page_tools/media_tools/session.rs). Captions are
  // read in every frame by captions.js before a question, so this never waits: the top
  // document's own video first, else the video playing in a frame below it (a course video in
  // Canvas plays in a frame from Canvas Studio, Kaltura, Panopto or YouTube).
  window.__mistyMediaContext = () => {
    const now = mediaSnapshot();
    const own = window.__mistyFrameMedia ? window.__mistyFrameMedia() : null;
    const local = {
      title: String(now.title || document.title || '').slice(0, 200),
      url: String(location.href).slice(0, 2048),
      time: now.position,
      duration: now.duration,
      paused: now.paused,
      hasMedia: now.hasMedia,
      captions: (own && own.captions) || null,
    };
    if (local.hasMedia && !local.paused) return local;
    const framed = window.__mistyFramedMedia ? window.__mistyFramedMedia() : null;
    if (!framed || !framed.hasMedia || (local.hasMedia && framed.paused)) return local;
    // The page around the frame names the video better than the player does.
    return {
      title: String(now.title || document.title || framed.title || '').slice(0, 200),
      url: local.url,
      time: framed.time,
      duration: framed.duration,
      paused: framed.paused,
      hasMedia: true,
      captions: framed.captions,
    };
  };
  let mediaTimer = 0;
  const reportMedia = () => {
    mediaTimer = 0;
    sendToHost('{"token":"' + shortcutToken + '","media":' + JSON.stringify(mediaSnapshot()) + '}');
  };
  const scheduleMediaReport = () => {
    if (window !== window.top || mediaTimer) return;
    // Events arrive in bursts (a seek is pause, seeked and play together); one report follows.
    mediaTimer = setTimeout(reportMedia, 80);
  };
  ['play', 'pause', 'ended', 'seeked', 'durationchange', 'loadedmetadata', 'emptied', 'ratechange',
   'enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged'].forEach((name) => {
    // Media events do not bubble, so they are caught on the way down.
    document.addEventListener(name, (event) => {
      const target = event.target;
      if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
        scheduleMediaReport();
      }
    }, true);
  });
  try {
    // A page announces a new track by setting its media session's metadata.
    const session = window.navigator && window.navigator.mediaSession;
    const prototype = session && Object.getPrototypeOf(session);
    const original = prototype && Object.getOwnPropertyDescriptor(prototype, 'metadata');
    if (session && original && original.get && original.set) {
      Object.defineProperty(session, 'metadata', {
        configurable: true,
        get() { return original.get.call(this); },
        set(value) { original.set.call(this, value); scheduleMediaReport(); },
      });
    }
  } catch (_) {}

  // A video that comes back from picture in picture still playing, as when its window's "back to
  // tab" is chosen, brings its tab with it. The page may have been hidden behind another tab by
  // then, and the system would return the video to a page it cannot find; the same trusted
  // focus signal as a click shows the tab first. Closing the floating window pauses the video, so
  // that does not pull the person back.
  const returnFromPictureInPicture = (event) => {
    const video = event.target;
    if (!event.isTrusted || !video || video.paused) return;
    // Brings Misty's window forward too, which the system does not do for a page it hosts.
    sendToHost('{"token":"' + shortcutToken + '","pipReturn":true}');
  };
  document.addEventListener('leavepictureinpicture', returnFromPictureInPicture, true);
  document.addEventListener('webkitpresentationmodechanged', (event) => {
    const video = event.target;
    if (video && video.webkitPresentationMode === 'inline') returnFromPictureInPicture(event);
  }, true);
