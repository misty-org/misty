import "@/styles/styles.css";
import "@/styles/App.css";
import "./film.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { cues } from "./film/cues";
import { Film } from "./film/Film";
import { measure, measurementRequests, missing } from "./film/measure";
import { FPS } from "./film/time";
import { Preview } from "./Preview";

declare global {
  interface Window {
    renderFrame: (frame: number) => Promise<void>;
    promoReady: boolean;
    promoCues: ReturnType<typeof cues>;
    promoMissing: string[];
  }
}

const rendering = new URLSearchParams(location.search).has("render");
let setTime: (t: number) => void = () => {};
const seek = (t: number) => setTime(t);
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function Root() {
  const [t, set] = useState(0);
  useEffect(() => {
    setTime = set;
  }, []);
  return rendering ? <Film t={t} /> : <Preview t={t} onSeek={seek} />;
}

async function boot() {
  createRoot(document.getElementById("root")!).render(<Root />);
  await settle();
  await document.fonts.ready;
  await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
  // Measure every cursor and camera target at the moment it is used.
  const requests = measurementRequests();
  for (const { at, target, render } of requests) {
    flushSync(() => setTime(render ?? at));
    await settle();
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
    measure(at, target);
  }
  window.promoMissing = requests.filter((r) => missing(r.at, r.target)).map((r) => `${r.at}s ${r.target}`);
  flushSync(() => setTime(0));
  window.renderFrame = async (frame: number) => {
    flushSync(() => setTime(frame / FPS));
    // Effects in shared components (column registration) settle before capture.
    await settle();
    await settle();
  };
  window.promoCues = cues();
  window.promoReady = true;
}

void boot();
