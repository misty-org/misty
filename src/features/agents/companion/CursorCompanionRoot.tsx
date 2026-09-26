import sprite from "@/assets/branding/misty-icon.png?inline";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { companionFollowPoint, normalizeCompanionSize } from "./companionSize";
import "./cursorCompanion.css";
import {
  BUBBLE_FADE_MS,
  flight,
  POINT_HOLD_MS,
  recordingPower,
  spring,
  waveformHeight,
  type Point,
} from "./motion";
import { cursorEvent, presentationEvent, type CursorSample, type Presentation } from "./protocol";
const initial: Presentation = {
  generation: 0,
  phase: "idle",
  visible: false,
  mode: "team",
  model: "",
};
export function CursorCompanionRoot() {
  return <CursorOverlay />;
}
function usePresentation() {
  const [state, setState] = useState(initial);
  useEffect(() => {
    let active = true;
    const remove = getCurrentWindow().listen<Presentation>(presentationEvent, ({ payload }) => {
      if (active) setState(payload);
    });
    void remove
      .then(() => invoke<Presentation | null>("cursor_companion_snapshot"))
      .then((snapshot) => {
        if (active && snapshot) setState(snapshot);
      });
    return () => {
      active = false;
      void remove.then((fn) => fn());
    };
  }, []);
  return state;
}
function CursorOverlay() {
  const presentation = usePresentation();
  const latest = useRef(presentation);
  latest.current = presentation;
  const group = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let power = 0,
      meterTurn = -1,
      lastMeterFrame = 0;
    const bubbleScale = {
        x: 0.5,
        y: 0,
      },
      bubbleVelocity = {
        x: 0,
        y: 0,
      };
    let sample: CursorSample | undefined;
    let position: Point | undefined;
    const velocity = {
      x: 0,
      y: 0,
    };
    let flightStart: Point = {
        x: 0,
        y: 0,
      },
      target = flightStart,
      returnMouse = flightStart;
    let navigation: "follow" | "out" | "hold" | "return" = "follow";
    let holdUntil = Infinity;
    let started = 0,
      last = performance.now(),
      seen = "",
      label = "",
      typed = 0,
      nextChar = 0;
    const id = Number(getCurrentWindow().label.replace("misty-cursor-", ""));
    const removers = [
      getCurrentWindow().listen<CursorSample>(cursorEvent, ({ payload }) => {
        sample = payload;
      }),
      getCurrentWindow().listen<{
        turn: number;
        power: number;
      }>("misty://cursor-meter", ({ payload }) => {
        if (payload.turn === latest.current.generation) {
          if (meterTurn !== payload.turn) power = 0;
          meterTurn = payload.turn;
          power = recordingPower(payload.power, power);
        }
      }),
    ];
    const finish = () => {
      navigation = "follow";
      void emitTo("main", "misty://cursor-point-finished", {
        generation: latest.current.generation,
      });
    };
    let frame = 0;
    const tick = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      if (now - lastMeterFrame >= 1000 / 36) {
        lastMeterFrame = now;
        const seconds = (Date.now() - Date.UTC(2001, 0, 1)) / 1000;
        meter.current?.querySelectorAll("span").forEach((bar, index) => {
          bar.style.height = `${waveformHeight(power, index, seconds)}px`;
        });
      }
      const d = sample?.displays.find((d) => d.id === id);
      if (!sample || !d || !group.current) return;
      const factor = /Mac/.test(navigator.platform) ? 1 : d.scale;
      const width = d.width / factor,
        height = d.height / factor;
      const mouse = {
        x: (sample.x - d.x) / factor,
        y: (sample.y - d.y) / factor,
      };
      const follow = companionFollowPoint(
        mouse,
        width,
        height,
        normalizeCompanionSize(latest.current.size),
      );
      position ??= {
        ...follow,
      };
      const state = latest.current;
      const key = `${state.generation}:${JSON.stringify(state.point)}`;
      if (key !== seen) {
        seen = key;
        navigation = "follow";
        velocity.x = 0;
        velocity.y = 0;
        if (state.point?.displayId === id) {
          target = {
            x: Math.max(20, Math.min(width - 20, (state.point.x - d.x) / factor + 8)),
            y: Math.max(20, Math.min(height - 20, (state.point.y - d.y) / factor + 12)),
          };
          flightStart = {
            ...position,
          };
          started = now;
          navigation = "out";
          const phrases = [
            "right here!",
            "this one!",
            "over here!",
            "click this!",
            "here it is!",
            "found it!",
          ];
          label = phrases[Math.floor(Math.random() * phrases.length)];
          typed = 0;
          bubbleScale.x = 0.5;
          bubbleVelocity.x = 0;
          nextChar = now;
        }
      }
      let scale = 1,
        rotation = 0;
      if (navigation === "out" || navigation === "return") {
        if (
          navigation === "return" &&
          Math.hypot(mouse.x - returnMouse.x, mouse.y - returnMouse.y) > 100
        )
          finish();
        else {
          const f = flight(flightStart, target, now - started);
          position = {
            x: f.x,
            y: f.y,
          };
          scale = f.scale;
          rotation = f.rotation;
          if (f.done) {
            if (navigation === "return") finish();
            else {
              navigation = "hold";
              holdUntil = Infinity;
              started = now;
            }
          }
        }
      } else if (navigation === "hold") {
        if (now > holdUntil + BUBBLE_FADE_MS) {
          navigation = "return";
          started = now;
          flightStart = {
            ...position,
          };
          target = follow;
          returnMouse = mouse;
        }
      } else spring(position, velocity, follow, dt);
      const onScreen = mouse.x >= 0 && mouse.y >= 0 && mouse.x < width && mouse.y < height;
      const visible = state.visible && (navigation !== "follow" || (!state.point && onScreen));
      group.current.style.opacity = visible ? "1" : "0";
      group.current.style.transform = `translate(${position.x}px, ${position.y}px)`;
      const image = group.current.querySelector<HTMLImageElement>(".cursor-sprite");
      if (image)
        image.style.transform = `translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`;
      if (bubble.current) {
        if (navigation === "hold" && now >= nextChar && typed < label.length) {
          typed++;
          nextChar = now + 30 + Math.random() * 30;
          if (typed === label.length) holdUntil = nextChar + POINT_HOLD_MS;
        }
        bubble.current.textContent = label.slice(0, typed);
        bubble.current.style.opacity = navigation === "hold" && now <= holdUntil ? "1" : "0";
        spring(
          bubbleScale,
          bubbleVelocity,
          {
            x: navigation === "hold" ? 1 : 0.5,
            y: 0,
          },
          dt,
          0.4,
        );
        bubble.current.style.transform = `translateY(-50%) scale(${bubbleScale.x})`;
        const glow = Math.max(0, 6 + (1 - bubbleScale.x) * 16);
        const alpha = Math.max(0, Math.min(1, 0.5 + (1 - bubbleScale.x)));
        bubble.current.style.boxShadow = `0 0 ${glow}px rgb(51 128 255 / ${alpha})`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      for (const remove of removers) void remove.then((fn) => fn());
    };
  }, []);
  return (
    <div className="cursor-overlay" aria-hidden="true">
      <div
        ref={group}
        className="cursor-group"
        data-phase={presentation.phase}
        style={
          {
            "--companion-scale": normalizeCompanionSize(presentation.size) / 100,
          } as CSSProperties
        }
      >
        <img className="cursor-sprite" src={sprite} alt="" />
        <div ref={meter} className="cursor-waveform">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} />
          ))}
        </div>
        <svg className="cursor-spinner" viewBox="-2 -2 18 18">
          <defs>
            <mask
              id="cursor-processing-arc"
              maskUnits="userSpaceOnUse"
              x="-2"
              y="-2"
              width="18"
              height="18"
            >
              <circle
                cx="7"
                cy="7"
                r="7"
                pathLength="100"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="70 30"
                strokeDashoffset="-15"
              />
            </mask>
          </defs>
          <foreignObject x="-2" y="-2" width="18" height="18" mask="url(#cursor-processing-arc)">
            <div className="cursor-spinner-gradient" />
          </foreignObject>
        </svg>
        <div ref={bubble} className="cursor-point-bubble" />
      </div>
    </div>
  );
}
