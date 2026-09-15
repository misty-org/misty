import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RefObject } from "react";
import { CompanionActivity } from "./companionActivity";
import { companionFollowPoint, normalizeCompanionSize } from "./companionSize";
import { listenToCursorInputs, type CursorInputs } from "./cursorOverlayInputs";
import {
  BUBBLE_FADE_MS,
  flight,
  POINT_HOLD_MS,
  spring,
  waveformHeight,
  type Point,
} from "./motion";
import { pointBubbleText, pointLayout, type PointLayout } from "./pointLayout";
import type { CursorSample, Presentation } from "./protocol";

export type CursorOverlayRefs = {
  latest: { current: Presentation };
  group: RefObject<HTMLDivElement | null>;
  bubble: RefObject<HTMLDivElement | null>;
  marker: RefObject<HTMLDivElement | null>;
  meter: RefObject<HTMLDivElement | null>;
};

function paintWaveform(meter: HTMLDivElement | null, power: number) {
  const seconds = (Date.now() - Date.UTC(2001, 0, 1)) / 1000;
  meter?.querySelectorAll("span").forEach((bar, index) => {
    bar.style.height = `${waveformHeight(power, index, seconds)}px`;
  });
}

// Drives the companion's position, flight and point bubble from requestAnimationFrame.
// Returns the cleanup that stops the loop and removes the event listeners.
export function startCursorOverlayLoop({
  latest,
  group,
  bubble,
  marker,
  meter,
}: CursorOverlayRefs): () => void {
  let disposed = false;
  let lastMeterFrame = 0;
  const inputs: CursorInputs = { sample: undefined, power: 0, meterTurn: -1 };
  const bubbleScale = {
      x: 0.5,
      y: 0,
    },
    bubbleVelocity = {
      x: 0,
      y: 0,
    };
  const activity = new CompanionActivity();
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
  // A walkthrough step stays until the person clicks it.
  let holdForClick = false;
  let markerBox: PointLayout["marker"] | undefined;
  let started = 0,
    last = performance.now(),
    seen = "",
    label = "",
    typed = 0,
    nextChar = 0;
  const id = Number(getCurrentWindow().label.replace("misty-cursor-", ""));
  const removers = listenToCursorInputs(id, activity, latest, inputs);
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
      paintWaveform(meter.current, inputs.power);
    }
    const sample: CursorSample | undefined = inputs.sample;
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
      markerBox = undefined;
      if (state.point?.displayId === id) {
        const layout = pointLayout(state.point, d, factor, state.size);
        target = layout.companion;
        markerBox = layout.marker;
        holdForClick = Boolean(state.point.awaitingClick);
        // The marker shows from the outbound flight until this hold ends.
        holdUntil = Infinity;
        flightStart = {
          ...position,
        };
        started = now;
        navigation = "out";
        label = pointBubbleText(state.point);
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
    const presence = activity.presentation(
      now,
      state.phase !== "idle" ||
        navigation !== "follow" ||
        Boolean(state.point) ||
        Boolean(state.error),
    );
    const visible =
      state.visible && presence.visible && (navigation !== "follow" || (!state.point && onScreen));
    group.current.style.transitionDuration = `${presence.fadeMs}ms`;
    group.current.style.opacity = visible ? "1" : "0";
    group.current.style.transform = `translate(${position.x}px, ${position.y}px)`;
    const errorBubble = group.current.querySelector<HTMLElement>(".cursor-error-bubble");
    if (errorBubble) {
      errorBubble.style.left = `${Math.max(8 - position.x, Math.min(10, width - position.x - errorBubble.offsetWidth - 8))}px`;
      errorBubble.style.top = `${Math.max(8 - position.y, Math.min(26, height - position.y - errorBubble.offsetHeight - 8))}px`;
    }
    const image = group.current.querySelector<HTMLImageElement>(".cursor-sprite");
    if (image)
      image.style.transform = `translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`;
    if (marker.current) {
      const shown =
        markerBox && (navigation === "out" || navigation === "hold") && now <= holdUntil;
      if (markerBox) {
        marker.current.style.transform = `translate(${markerBox.x}px, ${markerBox.y}px)`;
        marker.current.style.width = `${markerBox.width}px`;
        marker.current.style.height = `${markerBox.height}px`;
        marker.current.dataset.shape = markerBox.ring ? "ring" : "frame";
      }
      marker.current.style.opacity = shown ? "1" : "0";
    }
    if (bubble.current) {
      if (navigation === "hold" && now >= nextChar && typed < label.length) {
        typed++;
        nextChar = now + 30 + Math.random() * 30;
        if (typed === label.length) holdUntil = holdForClick ? Infinity : nextChar + POINT_HOLD_MS;
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
}
