import { useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings";
import { useSpacesStore } from "@/features/spaces";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Notification } from "@/shared/ui";
import { writeMorningBrief } from "./morningBrief";
import { useRecapRequest } from "./recapRequest";
import { windowSpaceId } from "./windowSpace";

/** The window's Space's memory tree, with that day's recap open beside it. */
function openBrief(day: string) {
  const spaces = useSpacesStore.getState().spaces;
  const id =
    windowSpaceId() ??
    (
      spaces.find((space) => space.is_default && space.role === "owner") ??
      spaces.find((space) => space.is_default)
    )?.id;
  if (!id) return;
  const route = `/spaces/${encodeURIComponent(id)}/memory`;
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
  useRecapRequest.setState({ day });
}

/** Writes the morning brief when the app is open on a new day, and says when it is ready. */
export function MorningBriefMount() {
  const settingsLoaded = useSettingsStore((state) => Boolean(state.settings));
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsLoaded || !hasTauriInternals()) return;
    const check = () =>
      void writeMorningBrief().then((day) => {
        if (day) setReady(day);
      });
    check();
    // An app left open overnight gets its brief when the person comes back.
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [settingsLoaded]);

  if (!ready) return null;
  return (
    <Notification onDismiss={() => setReady(null)}>
      Your morning brief is ready.{" "}
      <Button
        type="button"
        variant="link"
        size="none"
        onClick={() => {
          setReady(null);
          openBrief(ready);
        }}
      >
        Open
      </Button>
    </Notification>
  );
}
