import { Button } from "@/shared/ui";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Film } from "./film/Film";
import { DURATION, FPS, HEIGHT, sceneAt, scenes, WIDTH } from "./film/time";

/** Silent review player. Playback maps wall time onto the film timeline. */
export function Preview({ t, onSeek }: { t: number; onSeek: (t: number) => void }) {
  const [playing, setPlaying] = useState(false);
  const [scale, setScale] = useState(0.5);
  const clock = useRef<{ start: number; from: number } | null>(null);
  useEffect(() => {
    const start = Number(new URLSearchParams(location.search).get("t"));
    if (start) onSeek(start);
    const fit = () => setScale(Math.min((innerWidth - 32) / WIDTH, (innerHeight - 96) / HEIGHT));
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [onSeek]);
  useEffect(() => {
    if (!playing) return;
    clock.current = { start: performance.now(), from: t >= DURATION ? 0 : t };
    let frame = 0;
    const tick = (now: number) => {
      const next = clock.current!.from + (now - clock.current!.start) / 1000;
      if (next >= DURATION) {
        onSeek(DURATION - 1 / FPS);
        setPlaying(false);
        return;
      }
      onSeek(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Restart the clock only when playback toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
  return (
    <div className="flex h-screen flex-col items-center gap-3 overflow-hidden bg-[#050505] p-4 text-cream">
      <div style={{ width: WIDTH * scale, height: HEIGHT * scale }} className="overflow-hidden rounded-lg ring-1 ring-white/10">
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <Film t={t} />
        </div>
      </div>
      <div className="flex w-full max-w-[1100px] items-center gap-3 text-sm">
        <Button variant="outline" size="sm" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <input
          aria-label="Timeline"
          type="range"
          min={0}
          max={DURATION - 1 / FPS}
          step={1 / FPS}
          value={t}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="flex-1 accent-white"
        />
        <span className="w-16 tabular-nums text-cream-muted">{t.toFixed(2)}s</span>
        <select
          aria-label="Scene"
          value={sceneAt(t).id}
          onChange={(event) => onSeek(scenes.find((scene) => scene.id === event.target.value)!.start)}
          className="h-8 rounded-md border border-charcoal-border bg-charcoal-card px-2"
        >
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
