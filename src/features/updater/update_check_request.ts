import { openSettings } from "@/features/settings";

let pending = false;
const requested = "misty:check-for-updates";

export function requestUpdateCheck() {
  pending = true;
  openSettings("updates");
  window.dispatchEvent(new Event(requested));
}

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
