// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  atlasBackgroundPosition,
  PET_BUBBLE_HEIGHT,
  PET_BUBBLE_WIDTH,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  type PetAnimation,
  type PetPackage,
  type PetStatus,
} from "./petAtlas";
import type { PetActivity } from "./petState";
import {
  DEFAULT_PET_SCALE,
  normalizePetScale,
  PET_BASE_SCALE,
  PET_SCALE_OPTIONS,
} from "./petScale";
import { petScaleEvent, petStateEvent, petsApi, type NativePetState } from "./petsApi";
import "./petOverlay.css";

const DEFAULT_STATE: NativePetState = {
  sessionKey: null,
  sessionName: null,
  status: "idle",
  activity: "idle",
  lookDirection: 0,
  cursorNearby: false,
  cursorOver: false,
  changedAt: 0,
};

const IDLE_ANIMATIONS: readonly PetAnimation[] = ["stand", "rest", "lay"];

/** The bubble's words for what the agent is doing; idle has none. */
const activityLabels: Record<PetActivity, string> = {
  idle: "",
  thinking: "Thinking",
  tool: "Working",
  command: "Running a command",
  waiting: "Needs you",
  failed: "Something went wrong",
  completed: "Done",
};

/** Native pet state, the chosen package and its size. Size lives here because native code
 * pushes it on its own event. */
function usePetOverlayState() {
  const [pet, setPet] = useState<PetPackage | null>(null);
  const [state, setState] = useState(DEFAULT_STATE);
  const [scale, setScale] = useState(DEFAULT_PET_SCALE);
  const scaleRef = useRef(DEFAULT_PET_SCALE);

  const applyScale = useCallback((value: number | undefined) => {
    const next = normalizePetScale(value);
    scaleRef.current = next;
    setScale(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlistenState = listen<NativePetState>(petStateEvent, (event) => {
      setState({ ...DEFAULT_STATE, ...event.payload });
    });
    const unlistenScale = listen<number>(petScaleEvent, (event) => applyScale(event.payload));
    void (async () => {
      try {
        const [settings, current] = await Promise.all([petsApi.settings(), petsApi.overlayState()]);
        const petId = settings.petId.trim();
        // Native code opens this window only with a pet chosen; without one there is nothing to draw.
        if (!petId) return;
        const packageData = await petsApi.getPackage(petId);
        if (cancelled) return;
        setPet(packageData);
        setState({ ...DEFAULT_STATE, ...current });
        applyScale(settings.scale);
      } catch (error) {
        console.error("[pets] the pet could not load", error);
      }
    })();
    return () => {
      cancelled = true;
      void unlistenState.then((dispose) => dispose());
      void unlistenScale.then((dispose) => dispose());
    };
  }, [applyScale]);

  /** Steps to the next size; a failed native call puts the old one back. */
  const cycleScale = useCallback(async () => {
    const current = scaleRef.current;
    const currentIndex = PET_SCALE_OPTIONS.findIndex((value) => Math.abs(value - current) < 0.001);
    const next = PET_SCALE_OPTIONS[(currentIndex + 1) % PET_SCALE_OPTIONS.length];
    applyScale(next);
    try {
      applyScale(await petsApi.setScale(next));
    } catch {
      applyScale(current);
    }
  }, [applyScale]);

  return { pet, state, scale, cycleScale };
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

/** A random idle pose while nothing is going on, changed on a slow timer. */
function useIdleAnimation(active: boolean): PetAnimation {
  const [idleAnimation, setIdleAnimation] = useState<PetAnimation>("stand");
  useEffect(() => {
    if (!active) return;
    let timer: number | null = null;
    const changeIdleAnimation = () => {
      setIdleAnimation((current) => {
        const candidates = IDLE_ANIMATIONS.filter((candidate) => candidate !== current);
        return candidates[Math.floor(Math.random() * candidates.length)] ?? "stand";
      });
      timer = window.setTimeout(changeIdleAnimation, 2800 + Math.random() * 3200);
    };
    changeIdleAnimation();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active]);
  return idleAnimation;
}

/** The sprite's frame. It starts over when what the pet is doing changes, and steps at a pace
 * that suits the animation. */
function usePetFrame(input: {
  animation: PetAnimation;
  reducedMotion: boolean;
  status: PetStatus;
  activity: PetActivity;
  cursorNearby: boolean;
  cursorOver: boolean;
}): number {
  const { animation, reducedMotion, status, activity, cursorNearby, cursorOver } = input;
  const contextKey = `${activity}|${cursorNearby}|${cursorOver}|${status}`;
  const [frame, setFrame] = useState(0);
  const [prevContextKey, setPrevContextKey] = useState(contextKey);
  // Adjusting state while rendering, so a new context never paints one stale frame first.
  if (contextKey !== prevContextKey) {
    setPrevContextKey(contextKey);
    setFrame(0);
  }
  useEffect(() => {
    const frameDelay = reducedMotion
      ? 420
      : animation === "jump"
        ? 125
        : animation === "lay"
          ? 420
          : status === "waiting"
            ? 520
            : 180;
    const id = window.setInterval(() => setFrame((value) => value + 1), frameDelay);
    return () => window.clearInterval(id);
  }, [animation, reducedMotion, status]);
  return frame;
}

function PetBubble(props: { text: string; activityText: string; sessionName: string }) {
  return (
    <div
      className={`pet-bubble${props.text ? " pet-bubble-visible" : ""}`}
      aria-live="polite"
      aria-hidden={!props.text}
      aria-label={props.text || undefined}
    >
      {props.sessionName ? <span className="pet-bubble-session">{props.sessionName}</span> : null}
      <span className="pet-bubble-status">{props.activityText}</span>
    </div>
  );
}

/** The pet. It acts as a button, so changing its size works from the keyboard too; the drag
 * region still moves the window. */
function PetSprite(props: {
  pet: PetPackage;
  renderScale: number;
  backgroundPosition: string;
  onSavePosition(): void;
  onCycleScale(): void;
}) {
  const { pet, renderScale } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      data-tauri-drag-region
      className="pet-sprite"
      aria-label={pet.description || pet.displayName}
      style={{
        position: "absolute",
        left: ((PET_BUBBLE_WIDTH - PET_CELL_WIDTH) / 2) * renderScale,
        bottom: 0,
        width: PET_CELL_WIDTH * renderScale,
        height: PET_CELL_HEIGHT * renderScale,
        backgroundImage: `url(${pet.spritesheetDataUrl})`,
        backgroundSize: `${PET_CELL_WIDTH * 8 * renderScale}px ${PET_CELL_HEIGHT * 11 * renderScale}px`,
        backgroundPosition: props.backgroundPosition,
      }}
      onMouseUp={props.onSavePosition}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onCycleScale();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onCycleScale();
        }
      }}
    />
  );
}

/** The pet window: the sprite, and a bubble saying what the person's agents are doing. */
export function PetOverlayApp() {
  const { pet, state, scale, cycleScale } = usePetOverlayState();
  const reducedMotion = usePrefersReducedMotion();
  const idleActive = state.status === "idle" && !state.cursorNearby && !state.cursorOver;
  const idleAnimation = useIdleAnimation(idleActive);
  const renderScale = PET_BASE_SCALE * scale;

  const animation = useMemo<PetAnimation>(() => {
    if (state.cursorOver) return "jump";
    if (state.status !== "idle") return state.status;
    if (state.cursorNearby) return "idle";
    return idleAnimation;
  }, [idleAnimation, state.cursorNearby, state.cursorOver, state.status]);

  const frame = usePetFrame({
    animation,
    reducedMotion,
    status: state.status,
    activity: state.activity,
    cursorNearby: state.cursorNearby,
    cursorOver: state.cursorOver,
  });

  const backgroundPosition = useMemo(
    () =>
      atlasBackgroundPosition(animation, frame, state.lookDirection, pet?.frameCounts, renderScale),
    [animation, frame, pet?.frameCounts, renderScale, state.lookDirection],
  );

  const savePosition = async () => {
    try {
      const window = getCurrentWindow();
      const position = await window.outerPosition();
      const dpi = await window.scaleFactor();
      await petsApi.savePosition({
        x: position.x / dpi + ((PET_BUBBLE_WIDTH - PET_CELL_WIDTH) / 2) * renderScale,
        y: position.y / dpi + PET_BUBBLE_HEIGHT,
      });
    } catch {
      // The pet stays where it is; it just won't be there next launch.
    }
  };

  if (!pet) return null;

  const activityText = activityLabels[state.activity] ?? "";
  const sessionName = state.sessionName?.trim() ?? "";
  const bubbleText = activityText
    ? sessionName
      ? `${sessionName}: ${activityText}`
      : activityText
    : "";

  return (
    <main
      aria-label={pet.displayName}
      className="pet-overlay"
      data-tauri-drag-region
      style={{
        width: PET_BUBBLE_WIDTH * renderScale,
        height: PET_CELL_HEIGHT * renderScale + PET_BUBBLE_HEIGHT,
      }}
    >
      <PetBubble text={bubbleText} activityText={activityText} sessionName={sessionName} />
      <PetSprite
        pet={pet}
        renderScale={renderScale}
        backgroundPosition={backgroundPosition}
        onSavePosition={() => void savePosition()}
        onCycleScale={() => void cycleScale()}
      />
    </main>
  );
}
