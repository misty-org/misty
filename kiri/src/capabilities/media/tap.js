// media tap: sends this page's own audio while the host has a tab capture
// open. Idle until the host calls __kiriMediaTap.start(session). Media
// elements keep playing out loud; MediaStreams (calls) are only listened to.
{
  const RATE = 16000;
  let context = null;
  let sink = null;
  let session = 0;
  let observer = null;
  const routed = new WeakMap();
  const streams = new WeakMap();
  const crossOrigin = (media) => {
    const source = media.currentSrc || media.src;
    if (!source || media.srcObject || /^(blob|data|mediastream):/.test(source)) return false;
    try {
      return new URL(source, document.baseURI).origin !== location.origin && !media.crossOrigin;
    } catch {
      return true;
    }
  };
  const base64 = (samples) => {
    const bytes = new Uint8Array(samples.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const notice = (text) => signal('media', 'notice', { session, notice: text });
  const attach = (media) => {
    if (!sink || !context || context.state !== 'running') return;
    try {
      if (media.srcObject instanceof MediaStream) {
        if (streams.has(media) || !media.srcObject.getAudioTracks().length) return;
        const node = context.createMediaStreamSource(media.srcObject);
        node.connect(sink);
        streams.set(media, node);
        return;
      }
      if (crossOrigin(media)) {
        // Routing it would silence it for the person too.
        notice("Some audio on this page comes from another site and can't be transcribed.");
        return;
      }
      let node = routed.get(media);
      if (!node) {
        node = context.createMediaElementSource(media);
        // Once routed through the graph, an element is heard only through it.
        node.connect(context.destination);
        routed.set(media, node);
      }
      node.connect(sink);
    } catch {
      notice("Some audio on this page can't be transcribed.");
    }
  };
  const scan = () => document.querySelectorAll('audio, video').forEach(attach);
  const start = async (id) => {
    if (sink) return;
    session = id;
    context ??= new AudioContext({ sampleRate: RATE });
    if (context.state !== 'running') {
      await Promise.race([context.resume(), new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
    if (context.state !== 'running') {
      // Never route media into a silent graph: the person would lose the sound.
      notice('This page has to play something before Misty can hear it. Press play, then try again.');
      return;
    }
    sink = context.createScriptProcessor(4096, 1, 1);
    const quiet = context.createGain();
    quiet.gain.value = 0;
    sink.connect(quiet);
    quiet.connect(context.destination);
    sink.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 32768 : s * 32767;
      }
      signal('media', 'audio', { session, pcm: base64(pcm) });
    };
    scan();
    document.addEventListener('play', (event) => attach(event.target), true);
    observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  const stop = () => {
    if (!sink) return;
    sink.onaudioprocess = null;
    sink.disconnect();
    sink = null;
    observer?.disconnect();
    observer = null;
    session = 0;
  };
  Object.defineProperty(window, '__kiriMediaTap', { value: Object.freeze({ start, stop }), enumerable: false });
}
