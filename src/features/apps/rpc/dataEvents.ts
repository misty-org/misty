import type { MistyDataDomain } from "@misty/sdk";
import type { AppRpcScope } from "./session";

/** Host-only event adapter. Apps receive invalidation, not account-wide server event data. */
export function subscribeAppDataChanges(
  scope: AppRpcScope,
  domain: MistyDataDomain,
  listener: () => void,
) {
  scope.assert(`${domain}.read`);
  const prefix = {
    tasks: "task.",
    calendar: "calendar.",
    roadmaps: "roadmap.",
    notes: "note.",
    drawings: "drawing.",
  }[domain];
  const topic =
    domain === "notes"
      ? "misty:space-note-event"
      : domain === "drawings"
        ? "misty:space-drawing-event"
        : "misty:space-coordination-event";
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<{ space_id?: string; type?: string }>).detail;
    if (
      detail?.space_id !== scope.identity.spaceId ||
      typeof detail.type !== "string" ||
      !detail.type.startsWith(prefix)
    )
      return;
    try {
      scope.assert(`${domain}.read`);
    } catch {
      return;
    }
    listener();
  };
  window.addEventListener(topic, receive);
  return () => window.removeEventListener(topic, receive);
}
