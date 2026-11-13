import { openSettings } from "@/features/settings";

/** A check asked for from outside Settings (the menu bar), waiting for the Updates row to run it. */
let pending = false;
const requested = "misty:check-for-updates";

/** Opens Settings at Updates and checks there, where the person can install what it finds. */
export function requestUpdateCheck() {
  pending = true;
  openSettings("updates");
  window.dispatchEvent(new Event(requested));
}

/** Runs `check` for a request made before the row mounted, and for each one after. */
export function onUpdateCheckRequest(check: () => void): () => void {
  const take = () => {
    if (!pending) return;
    pending = false;
    check();
  };
  take();
  window.addEventListener(requested, take);
  return () => window.removeEventListener(requested, take);
}
