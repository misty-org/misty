/**
 * The magnitude spectrum of a frame of sound: an iterative radix-2 FFT with its twiddle factors
 * and Hann window worked out once per size.
 */
export class Spectrum {
  readonly size: number;
  private readonly window: Float32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly reversed: Uint32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error("The frame size is a power of two.");
    this.size = size;
    this.window = new Float32Array(size);
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let k = 0; k < size / 2; k++) {
      this.cos[k] = Math.cos((-2 * Math.PI * k) / size);
      this.sin[k] = Math.sin((-2 * Math.PI * k) / size);
    }
    this.reversed = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /** Writes |X[k]| for k in 0..size/2 of the windowed `frame` into `out` (size/2 + 1 long). */
  magnitudes(frame: Float32Array, out: Float32Array): void {
    const { size, re, im, reversed, window, cos, sin } = this;
    for (let i = 0; i < size; i++) {
      re[reversed[i]] = frame[i] * window[i];
      im[i] = 0;
    }
    for (let span = 2; span <= size; span <<= 1) {
      const half = span >> 1;
      const stride = size / span;
      for (let start = 0; start < size; start += span) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * stride];
          const s = sin[k * stride];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= size / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  }
}
