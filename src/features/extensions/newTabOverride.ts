import { configureNewTabOverride } from "@/features/workspace/browserHome";
import { installations, useExtensionsStore } from "./store";

/**
 * The new-tab page comes from the most recently added running extension that
 * replaces it, as in Chrome. Turning that extension off hands new tabs back to the
 * next one, or to the homepage.
 */
export function newTabOverride(): string | null {
  const { states, supported } = useExtensionsStore.getState();
  if (!supported) return null;
  const running = new Map(
    states.filter((state) => state.status === "enabled" && state.newTab).map((s) => [s.id, s.newTab!]),
  );
  const winner = installations()
    .filter((item) => item.installed && item.enabled && running.has(item.id))
    .pop();
  return winner ? running.get(winner.id)! : null;
}

/** Keeps new tabs pointed at the current override. Returns a stop function. */
export function startNewTabOverride(): () => void {
  const apply = () => configureNewTabOverride(newTabOverride());
  apply();
  const stop = useExtensionsStore.subscribe(apply);
  return () => {
    stop();
    configureNewTabOverride(null);
  };
}
