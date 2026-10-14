/**
 * Quiet wind for the welcome flight: filtered noise whose loudness and pitch follow the clouds' speed.
 * Synthesised, so there is no audio asset. Callers only play it after a click (browsers require one)
 * and never with reduced motion.
 */
type Gust = { out: GainNode; src: AudioBufferSourceNode };

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let gust: Gust | null = null;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

function audio(): AudioContext | null {
  if (!context) {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    // Pages can't read or override the system volume, so cap our own output: a low master level into
    // a brick-wall limiter keeps peaks near -32 dBFS, far below music or video at the same volume.
    master = context.createGain();
    master.gain.value = 0.6;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -32;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(context.destination);
    // Pinkish noise, decorrelated per ear for width.
    noise = context.createBuffer(2, context.sampleRate * 4, context.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = noise.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.03;
        b1 = 0.985 * b1 + white * 0.06;
        b2 = 0.95 * b2 + white * 0.12;
        data[i] = (b0 + b1 + b2 + white * 0.05) * 0.5;
      }
    }
  }
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

/** shape(t) gives 0..1 intensity over `duration` seconds: the air band's level and pitch, and a rumble. */
function wind(shape: (t: number) => number, duration: number, level: number) {
  hushWind();
  const ac = audio();
  if (!ac || !master || !noise) return;
  const now = ac.currentTime + 0.02;
  const n = Math.ceil(duration * 60);
  const air = new Float32Array(n);
  const low = new Float32Array(n);
  const pitch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = clamp01(shape((i / (n - 1)) * duration));
    air[i] = level * Math.pow(k, 1.4) + 1e-4;
    low[i] = level * 1.3 * k + 1e-4;
    pitch[i] = 240 + 1150 * k;
  }
  const src = ac.createBufferSource();
  src.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.8;
  band.frequency.setValueCurveAtTime(pitch, now, duration);
  const bandGain = ac.createGain();
  bandGain.gain.setValueCurveAtTime(air, now, duration);
  const body = ac.createBiquadFilter();
  body.type = "lowpass";
  body.frequency.value = 170;
  const bodyGain = ac.createGain();
  bodyGain.gain.setValueCurveAtTime(low, now, duration);
  const out = ac.createGain();
  src.connect(band).connect(bandGain).connect(out);
  src.connect(body).connect(bodyGain).connect(out);
  out.connect(master);
  src.start(now, Math.random() * 1.5);
  src.stop(now + duration + 0.05);
  gust = { out, src };
}

/** Fades whatever is playing instead of cutting it. */
export function hushWind() {
  if (!gust || !context) return;
  const now = context.currentTime;
  gust.out.gain.cancelScheduledValues(now);
  gust.out.gain.setValueAtTime(gust.out.gain.value, now);
  gust.out.gain.setTargetAtTime(0, now, 0.25);
  gust.src.stop(now + 1.5);
  gust = null;
}

/** Follows the intro's speed curve, with a faint breeze left under the title that fades by ~5.5s. */
export function playIntroWind() {
  wind(
    (t) => {
      const rush = smooth(clamp01(t / 0.7)) * Math.exp(-Math.max(0, t - 1.3) / 1.05);
      return 0.55 * rush + 0.05 * (1 - smooth(clamp01((t - 3) / 2.5)));
    },
    5.5,
    0.12,
  );
}

/** Builds with the dive, then eases out slowly as the mist closes in. */
export function playDiveWind() {
  wind(
    (t) => (t < 1.1 ? 0.7 * (t / 1.1) ** 2 : 0.7 * Math.exp(-(((t - 1.1) / 0.75) ** 1.6))),
    3,
    0.17,
  );
}
