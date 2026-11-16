import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** How far, in pixels, the mouse moves with a button down before it counts as a drag. */
const DRAG_START = 4;

/**
 * Holding the pointer while the camera is dragged, the way a game does: once a press has moved
 * far enough to be a drag, the cursor stays put and hidden and every movement of the mouse still
 * turns the camera, past the window's edge or the screen's. A plain click is never held, so it
 * lands where it was made. Released when the button comes up. Where the computer refuses the
 * lock, the pointer is still captured by the room, so leaving the window doesn't drop the drag.
 */
export function pointerHold(target: HTMLElement) {
  let down = false;
  let travelled = 0;
  return {
    press(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      down = true;
      travelled = 0;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Nothing to capture.
      }
    },
    move(event: PointerEvent) {
      if (!down || holdingPointer(target)) return;
      travelled += Math.abs(event.movementX) + Math.abs(event.movementY);
      if (travelled < DRAG_START) return;
      try {
        const asked = target.requestPointerLock() as unknown;
        // Newer engines answer with a promise, which rejects when the lock is refused.
        if (asked instanceof Promise) asked.catch(() => undefined);
      } catch {
        // No pointer lock here; the capture still holds the drag.
      }
    },
    release() {
      down = false;
      releasePointer(target);
    },
  };
}

/** The room holding the pointer through the window itself, where the web view refuses a lock. */
let grabbed: HTMLElement | null = null;
/** The room asked for a lock and is waiting to hear whether it got one. */
let asking: HTMLElement | null = null;

/** Holds the pointer from a plain click, for a free camera that turns with the mouse unpressed.
 * The web view's own lock is asked for first; where it is refused (the desktop app's web view
 * refuses it), the window grabs the cursor and hides it instead, so the mouse still turns the
 * camera however far it goes. */
export function holdPointer(target: HTMLElement) {
  if (holdingPointer(target)) return;
  asking = target;
  const refused = () => {
    if (asking !== target) return;
    asking = null;
    void grabCursor(target);
  };
  document.addEventListener("pointerlockerror", refused, { once: true });
  try {
    const asked = target.requestPointerLock() as unknown;
    if (asked instanceof Promise) asked.catch(refused);
  } catch {
    refused();
  }
  // Some engines refuse without a word: no lock a moment later counts as refused.
  window.setTimeout(() => {
    document.removeEventListener("pointerlockerror", refused);
    if (document.pointerLockElement === target) asking = null;
    else refused();
  }, 200);
}

async function grabCursor(target: HTMLElement) {
  if (!hasTauriInternals()) return;
  grabbed = target;
  target.style.cursor = "none";
  try {
    const frame = getCurrentWindow();
    await frame.setCursorGrab(true);
    await frame.setCursorVisible(false);
  } catch {
    if (grabbed === target) letGo(target);
  }
}

function letGo(target: HTMLElement) {
  grabbed = null;
  target.style.cursor = "";
  if (!hasTauriInternals()) return;
  const frame = getCurrentWindow();
  void frame.setCursorGrab(false).catch(() => undefined);
  void frame.setCursorVisible(true).catch(() => undefined);
}

/** Lets go of the pointer if the room is holding it. */
export function releasePointer(target: HTMLElement) {
  if (asking === target) asking = null;
  if (document.pointerLockElement === target) document.exitPointerLock();
  if (grabbed === target) letGo(target);
}

export const holdingPointer = (target: HTMLElement) =>
  document.pointerLockElement === target || grabbed === target;
