import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { RefObject } from "react";
import { cn, screenMarkClass } from "@misty/ui";
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
import { createSketchPainter } from "./overlaySketch";
import { createTrailPainter } from "./overlayTrail";
import { focusBoxes, pointBubbleText, pointLayout, type PointLayout } from "./pointLayout";
import type { CursorSample, Presentation } from "./protocol";

type CursorOverlayRefs = {
  latest: { current: Presentation };
  group: RefObject<HTMLDivElement | null>;
  bubble: RefObject<HTMLDivElement | null>;
  marker: RefObject<HTMLDivElement | null>;
  meter: RefObject<HTMLDivElement | null>;
  /** Teach mode's outlined regions. */
  focus?: RefObject<HTMLDivElement | null>;
  /** A reply's drawing: a whiteboard card or marks on the screen. */
  sketch?: RefObject<HTMLDivElement | null>;
  /** The paint the pointer leaves while the person asks. */
  trail?: RefObject<HTMLDivElement | null>;
  /** The caption at the bottom of the screen. */
  caption?: RefObject<HTMLDivElement | null>;
};

function paintWaveform(meter: HTMLDivElement | null, power: number) {
  const seconds = (Date.now() - Date.UTC(2001, 0, 1)) / 1000;
  meter?.querySelectorAll("span").forEach((bar, index) => {
    bar.style.height = `${waveformHeight(power, index, seconds)}px`;
  });
}

/** How long a word takes at the normal speaking rate: about 150 words a minute. */
const WORD_MS = 400;
/** How high Misty bobs with a word, at the default size. */
const BOB = 3;
/** Misty's own radius at the default size: half her 32-point picture. */
const MISTY_RADIUS = 16;
/** How long the shortcut hint stays as Misty first appears. */
const HINT_FIRST_MS = 8_000;
/** How long the pointer rests before Misty says her shortcuts again, in her first week. */
const HINT_REST_MS = 60_000;

// Drives the companion's position, flight and point bubble from requestAnimationFrame.
// Returns the cleanup that stops the loop and removes the event listeners.
export function startCursorOverlayLoop({
  latest,
  group,
  bubble,
  marker,
  meter,
  focus,
  sketch,
  trail,
  caption,
}: CursorOverlayRefs): () => void {
  let focusSeen = "";
  let paintSketch: ReturnType<typeof createSketchPainter> | undefined;
  let paintTrail: ReturnType<typeof createTrailPainter> | undefined;
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
  /** Where the pointer was last frame. */
  let pointerAt: Point | undefined;
  /** Where Misty waits once the pointer rests, and whether this overlay holds the pointer. */
  let parkedAt: Point | undefined;
  let holding = false;
  /** Until when the first hint shows, and when the pointer last moved. */
  let hintFirstUntil = 0;
  let movedAt = performance.now();
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
  const removers = listenToCursorInputs(latest, inputs);
  const finish = () => {
    navigation = "follow";
    void emit("misty://cursor-point-finished", {
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
    // Teach mode's regions: rebuilt only when they or this display change.
    const focusKey = `${JSON.stringify(state.focus)}:${d.x},${d.y},${d.width},${d.height},${factor}`;
    if (focus?.current && focusKey !== focusSeen) {
      focusSeen = focusKey;
      focus.current.replaceChildren(
        ...focusBoxes(state.focus, d, factor).map((box) => {
          const outline = document.createElement("div");
          outline.className = cn(
            "absolute top-0 left-0 animate-[misty-fade-in_0.25s_ease-out] motion-reduce:animate-none",
            screenMarkClass.spotlight,
          );
          outline.style.transform = `translate(${box.x}px, ${box.y}px)`;
          outline.style.width = `${box.width}px`;
          outline.style.height = `${box.height}px`;
          return outline;
        }),
      );
    }
    if (sketch?.current) {
      paintSketch ??= createSketchPainter(sketch.current);
      paintSketch(state.sketch, d, factor, mouse);
    }
    if (caption?.current) {
      // The caption shows on the display the person is looking at: the one with the pointer.
      const here = mouse.x >= 0 && mouse.y >= 0 && mouse.x < width && mouse.y < height;
      const line = here ? state.caption : undefined;
      if (line && caption.current.textContent !== line.text)
        caption.current.textContent = line.text;
      caption.current.toggleAttribute("data-hidden", !line);
      caption.current.toggleAttribute("data-tip", Boolean(line?.tip));
    }
    if (trail?.current) {
      // What the person circles while they ask, painted on the display they're drawing on.
      paintTrail ??= createTrailPainter(trail.current);
      const here = mouse.x >= 0 && mouse.y >= 0 && mouse.x < width && mouse.y < height;
      paintTrail(state.phase === "listening" && here, mouse);
    }
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
    // Misty rests beside the pointer while Tutor isn't in use, and steps out of the way while the
    // pointer is flung across the screen, coming back once it slows down.
    if (!pointerAt || Math.hypot(mouse.x - pointerAt.x, mouse.y - pointerAt.y) > 2) movedAt = now;
    pointerAt = mouse;
    const scale = normalizeCompanionSize(state.size) / 100;
    // Misty stays attached to the pointer at all times, including while buttons are held.
    parkedAt = undefined;
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
    } else if (parkedAt) spring(position, velocity, parkedAt, dt);
    else {
      // Attached to the pointer: no easing lag while it moves.
      position.x = follow.x;
      position.y = follow.y;
      velocity.x = 0;
      velocity.y = 0;
    }
    const onScreen = mouse.x >= 0 && mouse.y >= 0 && mouse.x < width && mouse.y < height;
    const visible = state.visible && (navigation !== "follow" || (!state.point && onScreen));
    // Away while the person types, is in a full-screen app, or the system has hidden the pointer
    // (an app hides it while typing or playing video): she goes where it goes, and comes back
    // with it.
    const away = Boolean(sample.typing || sample.fullscreen || sample.cursorShown === false);
    const resting =
      state.sprite === true &&
      !state.spriteAway &&
      !away &&
      navigation === "follow" &&
      !state.point &&
      onScreen;
    // The pointer over a parked Misty: this overlay takes it, so the click or the drop is hers.
    const onMisty =
      resting &&
      !visible &&
      parkedAt !== undefined &&
      Math.hypot(mouse.x - position.x, mouse.y - position.y) <= MISTY_RADIUS * scale + 4;
    // Over a 3D model's card it takes it too, so the model can be turned and its parts clicked.
    const card = paintSketch?.modelCard();
    const onModel =
      card !== undefined &&
      mouse.x >= card.x &&
      mouse.y >= card.y &&
      mouse.x < card.x + card.width &&
      mouse.y < card.y + card.height;
    const over = onMisty || onModel;
    if (over !== holding) {
      holding = over;
      void invoke("cursor_companion_hit", { over }).catch(() => undefined);
    }
    // During a drag she dims, out of the way, until the pointer brings it to her.
    group.current.style.opacity =
      visible || resting ? "1" : "0";
    group.current.toggleAttribute("data-on-misty", onMisty);
    // While Tutor talks, Misty bobs once a word, at the voice's pace.
    const misty = group.current.querySelector<HTMLElement>(".cursor-misty");
    if (misty) {
      const words = state.phase === "responding" ? state.words : undefined;
      let bob = 0;
      if (words) {
        const perWord = WORD_MS / words.rate;
        const into = Date.now() - words.at;
        if (into >= 0 && into < words.count * perWord)
          bob = Math.sin(((into % perWord) / perWord) * Math.PI) * BOB * scale;
      }
      misty.style.transform = bob ? `translateY(${(-bob).toFixed(2)}px)` : "";
    }
    const hint = group.current.querySelector<HTMLElement>(".cursor-hint-bubble");
    if (hint) {
      if (state.hint?.first && !hintFirstUntil) hintFirstUntil = now + HINT_FIRST_MS;
      const say =
        resting &&
        !visible &&
        !state.handoff &&
        (now < hintFirstUntil || now - movedAt >= HINT_REST_MS);
      hint.style.opacity = say ? "1" : "0";
    }
    group.current.style.transform = `translate(${position.x}px, ${position.y}px)`;
    const errorBubble = group.current.querySelector<HTMLElement>(".cursor-error-bubble");
    if (errorBubble) {
      errorBubble.style.left = `${Math.max(8 - position.x, Math.min(10, width - position.x - errorBubble.offsetWidth - 8))}px`;
      errorBubble.style.top = `${Math.max(8 - position.y, Math.min(26, height - position.y - errorBubble.offsetHeight - 8))}px`;
    }
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
    // Never leave the pointer held by an overlay that's going away.
    if (holding) void invoke("cursor_companion_hit", { over: false }).catch(() => undefined);
    for (const remove of removers) void remove.then((fn) => fn());
  };
}
