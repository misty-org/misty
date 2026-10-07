import mistyLogo from "@/assets/branding/misty-white.png";
import type { Callout } from "./director";
import type { Cam, CursorFrame, Point } from "./motion";
import { HEIGHT, scenes, window01, WIDTH } from "./time";

export const toScreen = (p: Point, cam: Cam): Point => ({
  x: (p.x - cam.x) * cam.zoom + WIDTH / 2,
  y: (p.y - cam.y) * cam.zoom + HEIGHT / 2,
});

/** Feature name, small and secondary, at the lower left as each section begins. */
export function Label({ t }: { t: number }) {
  return (
    <>
      {scenes
        .filter((scene) => scene.id !== "intro" && scene.id !== "close")
        .map((scene) => {
          const hold = scene.id === "sync" ? 4.6 : 3.8;
          const opacity = window01(t, scene.start + 0.45, scene.start + 0.45 + hold, 0.45);
          if (opacity <= 0) return null;
          return (
            <div key={scene.id} className="pointer-events-none absolute bottom-0 left-0" style={{ opacity }}>
              <div
                className="absolute bottom-0 left-0 h-[300px] w-[980px]"
                style={{ background: "radial-gradient(ellipse at 0% 100%, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 38%, transparent 70%)" }}
              />
              <div className="relative ml-[72px] mb-[64px] w-[900px]">
                <p className="text-[38px] leading-tight font-semibold tracking-tight text-white">{scene.title}</p>
                {scene.subtitle && <p className="mt-1 text-[24px] text-[#b5b5b5]">{scene.subtitle}</p>}
              </div>
            </div>
          );
        })}
    </>
  );
}

export function Cursor({ frame, cam }: { frame: CursorFrame; cam: Cam }) {
  const p = toScreen(frame, cam);
  const scale = frame.press ? 0.88 : 1;
  return (
    <div className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
      {frame.ripple !== null && (
        <span
          className="absolute rounded-full border-2 border-white"
          style={{
            width: 16 + frame.ripple * 40,
            height: 16 + frame.ripple * 40,
            left: -(8 + frame.ripple * 20),
            top: -(8 + frame.ripple * 20),
            opacity: 0.55 * (1 - frame.ripple),
          }}
        />
      )}
      <svg width="30" height="30" viewBox="0 0 24 24" style={{ transform: `scale(${scale})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }}>
        <path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L17 14.2 Z" fill="white" stroke="black" strokeWidth="1.25" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Logo({ opacity, subtitle, subtitleOpacity }: { opacity: number; subtitle: string; subtitleOpacity: number }) {
  if (opacity <= 0) return null;
  return (
    <div className="absolute inset-0 grid place-items-center" style={{ opacity }}>
      <div className="text-center" style={{ transform: `translateY(${(1 - opacity) * 12}px)` }}>
        <div className="flex items-center justify-center gap-7">
          <img src={mistyLogo} alt="" className="size-[112px]" />
          <span className="text-[104px] font-semibold tracking-[-0.03em] text-white">Misty</span>
        </div>
        <p className="mt-6 text-[30px] text-[#b5b5b5]" style={{ opacity: subtitleOpacity }}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

export function CalloutTag({ callout, point }: { callout: Callout; point: Point }) {
  if (callout.opacity <= 0) return null;
  const x = point.x + callout.dx;
  return (
    <div className="pointer-events-none absolute left-0 top-0" style={{ opacity: callout.opacity }}>
      <span className="absolute h-px bg-white/70" style={{ left: point.x + 14, top: point.y, width: callout.dx - 14 }} />
      <span
        className="absolute flex h-12 -translate-y-1/2 items-center whitespace-nowrap rounded-full border border-white/40 bg-black/80 px-5 text-[22px] text-white"
        style={{ left: x, top: point.y }}
      >
        {callout.text}
      </span>
    </div>
  );
}
