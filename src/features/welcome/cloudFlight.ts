/**
 * The welcome screen's flight through cloud: drifts at a crawl until begin(), then speeds up into the
 * cloud bank, pushes through ~4s of mist and eases out into clear air. dive() flies back in on exit.
 * Plain canvas, outside React: it redraws every frame. Design sample: docs/design/onboarding/samples.html.
 */
export type CloudTheme = "dark" | "light";

export interface CloudFlight {
  begin(): void;
  dive(): void;
  setTheme(theme: CloudTheme): void;
  destroy(): void;
}

type Puff = { dx: number; dy: number; dz: number; s: number; a: number; ph: number; i: number };
type Cloud = { x: number; y: number; z: number; puffs: Puff[] };

const PEAK = 2.4;
const CRUISE = 0.07;
const DIVE_SECONDS = 1.9;
const SPRITES = 6;

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

function noise2(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (
    (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) +
    (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v
  );
}

function fbm(x: number, y: number, seed: number) {
  let a = 0.5;
  let f = 1;
  let t = 0;
  for (let o = 0; o < 5; o++) {
    t += a * noise2(x * f, y * f, seed + o * 17);
    f *= 2.03;
    a *= 0.5;
  }
  return t;
}

/** Gray, lit-from-above puffs built from domain-warped noise. Light mode is grayer so it reads on white. */
function buildSprites(theme: CloudTheme): HTMLCanvasElement[] {
  const light = theme === "light";
  const base = light ? 196 : 170;
  const N = 224;
  const sm = (a: number, b: number, x: number) => smooth(clamp01((x - a) / (b - a)));
  return Array.from({ length: SPRITES }, () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = N;
    const g = canvas.getContext("2d");
    if (!g) return canvas;
    const img = g.createImageData(N, N);
    const seed = Math.floor(rnd(1, 9999));
    const d = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = (x / N - 0.5) * 2;
        const py = (y / N - 0.5) * 2;
        const e = Math.hypot(px / 0.92, py / (py > 0 ? 0.55 : 0.8));
        const qx = fbm(px * 1.7 + 3, py * 1.7, seed);
        const qy = fbm(px * 1.7, py * 1.7 + 9, seed + 5);
        d[y * N + x] =
          fbm(px * 2.4 + qx * 1.4, py * 2.4 + qy * 1.4, seed + 11) * 0.95 + (1 - e) * 0.95;
      }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const dv = d[i];
        const hx = d[y * N + Math.min(N - 1, x + 3)] - d[y * N + Math.max(0, x - 3)];
        const hy = d[Math.min(N - 1, y + 3) * N + x] - d[Math.max(0, y - 3) * N + x];
        let v =
          base +
          (hx + hy) * (light ? 120 : 150) -
          sm(0.85, 1.35, dv) * (light ? 70 : 62) +
          (light ? 0 : 12);
        v = Math.max(light ? 118 : 88, Math.min(light ? 246 : 226, v));
        const k = i * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = sm(0.5, 0.98, dv) * 0.5 * 255;
      }
    g.putImageData(img, 0, 0);
    return canvas;
  });
}

// Respawned clouds avoid the middle once the rush is over, so the title sits in clear air.
function place(cloud: Pick<Cloud, "x" | "y">, open: boolean) {
  do {
    cloud.x = rnd(-2.3, 2.3);
    cloud.y = rnd(-1.45, 1.45);
  } while (open && Math.hypot(cloud.x / 0.9, cloud.y / 0.55) < 1);
}

export function startCloudFlight(
  canvas: HTMLCanvasElement,
  options: { theme: CloudTheme; reducedMotion: boolean },
): CloudFlight {
  const ctx = canvas.getContext("2d");
  const trail = document.createElement("canvas");
  const trailCtx = trail.getContext("2d");
  let theme = options.theme;
  let sprites = buildSprites(theme);
  let clouds: Cloud[] = [];
  let W = 0;
  let H = 0;
  let startedAt: number | null = null;
  let diveAt: number | null = null;
  let last = 0;
  let raf = 0;
  let mx = 0;
  let my = 0;
  let smx = 0;
  let smy = 0;

  const populate = () => {
    clouds = Array.from({ length: Math.round(Math.min(80, (W * H) / 17000)) }, () => {
      const cloud: Cloud = { x: 0, y: 0, z: rnd(0.12, 1.6), puffs: [] };
      place(cloud, false);
      for (let j = 0; j < 4; j++)
        cloud.puffs.push({
          dx: gauss() * 0.24,
          dy: gauss() * 0.1,
          dz: gauss() * 0.05,
          s: rnd(0.34, 0.7),
          a: rnd(0.65, 1),
          ph: rnd(0, 6.28),
          i: Math.floor(rnd(0, SPRITES)),
        });
      return cloud;
    });
  };
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = canvas.clientWidth;
    const nextH = canvas.clientHeight;
    if (!nextW || !nextH) return;
    const grew = nextW * nextH > W * H * 1.5;
    W = nextW;
    H = nextH;
    canvas.width = trail.width = Math.round(W * dpr);
    canvas.height = trail.height = Math.round(H * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!clouds.length || grew) populate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    mx = (event.clientX - rect.left) / (rect.width || 1) - 0.5;
    my = (event.clientY - rect.top) / (rect.height || 1) - 0.5;
  };
  window.addEventListener("pointermove", onPointer);

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!ctx || !trailCtx || !W || document.hidden) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    // Held at the start, drifting at cruise speed, until begin(); reduced motion rests settled.
    const t = options.reducedMotion ? 99 : startedAt == null ? 0 : (now - startedAt) / 1000;
    const ex = diveAt == null ? 0 : clamp01((now - diveAt) / 1000 / DIVE_SECONDS);
    const light = theme === "light";
    smx += (mx - smx) * 0.04;
    smy += (my - smy) * 0.04;

    // Speed: ease up over 0.7s, hold, then a long exponential ease-out; the dive accelerates back in.
    const accel = smooth(clamp01(t / 0.7));
    const decay = Math.exp(-Math.max(0, t - 1.3) / 1.05);
    const v = options.reducedMotion ? 0 : CRUISE + PEAK * accel * decay + ex * ex * 3.2;
    const rush = clamp01((v - CRUISE) / PEAK);
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.46;
    const sc = Math.max(W, H) * 0.5;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    // Warp: the last frame redrawn slightly zoomed, so mist smears past while moving fast.
    const trailAlpha = 0.62 * Math.pow(rush, 0.8) * smooth(clamp01(t / 0.5));
    if (trailAlpha > 0.01) {
      const zoom = 1 + (0.006 + 0.05 * rush) * dt * 60;
      const fw = canvas.width * zoom;
      const fh = canvas.height * zoom;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = trailAlpha;
      ctx.drawImage(trail, (canvas.width - fw) / 2, (canvas.height - fh) / 2, fw, fh);
      ctx.restore();
    }
    for (const cloud of clouds) {
      cloud.z -= v * dt;
      if (cloud.z < 0.06) {
        cloud.z += 1.5;
        place(cloud, rush < 0.5);
      }
    }
    clouds.sort((a, b) => b.z - a.z);
    const baseAlpha = light ? 0.16 : 0.055;
    for (const cloud of clouds)
      for (const puff of cloud.puffs) {
        const z = cloud.z + puff.dz;
        if (z < 0.06) continue;
        // Fade in from the distance; near clouds stay until they wash over the camera.
        const k = 1 / z;
        const far = clamp01((1.6 - z) / 0.45);
        const near = smooth(clamp01((z - 0.06) / 0.32));
        const x = cx + (cloud.x + puff.dx + smx * 0.3) * k * sc * 0.45;
        const y = cy + (cloud.y + puff.dy + smy * 0.3) * k * sc * 0.45;
        const w = puff.s * k * sc * (1 + 0.03 * Math.sin(t * 0.5 + puff.ph)) * 1.7;
        const h = w * 0.82;
        const alpha = puff.a * baseAlpha * (1 - 0.55 * trailAlpha) * far * near;
        // Upright, but stretched along the line of flight so the rush reads as speed.
        const angle = Math.atan2(y - cy, x - cx);
        const stretch = 1 + 0.7 * rush * clamp01(Math.hypot(x - cx, y - cy) / (R * 1.2));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(stretch, 1);
        ctx.rotate(-angle);
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.drawImage(sprites[puff.i], -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    ctx.globalAlpha = 1;
    trailCtx.clearRect(0, 0, trail.width, trail.height);
    trailCtx.drawImage(canvas, 0, 0);
    // Inside the cloud: a veil, thicker at the edges like a tunnel, that thins in clear air.
    // Drawn after the trail capture so it never compounds.
    const veil = Math.pow(rush, 1.15) * (light ? 0.62 : 0.5);
    if (veil > 0.005) {
      const g = light ? 206 : 92;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) / 2);
      gradient.addColorStop(0, `rgba(${g},${g},${g},${veil * 0.35})`);
      gradient.addColorStop(0.55, `rgba(${g},${g},${g},${veil * 0.7})`);
      gradient.addColorStop(1, `rgba(${g},${g},${g},${veil})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
    }
  };
  resize();
  raf = requestAnimationFrame(frame);

  return {
    begin() {
      startedAt ??= performance.now();
    },
    dive() {
      startedAt ??= performance.now() - 10_000;
      diveAt ??= performance.now();
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      sprites = buildSprites(theme);
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
    },
  };
}
