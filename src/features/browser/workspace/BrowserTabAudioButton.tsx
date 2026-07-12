import { Volume2, VolumeX } from "lucide-react";
import type { WorkspaceTab } from "@/features/workspace";
import { useBrowserMediaStore } from "../library/mediaStore";

/**
 * A speaker on a workspace tab while one of its browser pages plays sound,
 * like Chrome's tab audio indicator. Clicking it mutes or unmutes that page.
 */
export function BrowserTabAudioButton(props: { tabs: WorkspaceTab[]; className: string }) {
  const target = useBrowserMediaStore((state) => {
    const browserTabs = props.tabs.filter((tab) => tab.surfaceId === "browser");
    return (
      browserTabs.find((tab) => state.audible[tab.id])?.id ??
      browserTabs.find((tab) => state.muted[tab.id])?.id ??
      null
    );
  });
  const muted = useBrowserMediaStore((state) => (target ? Boolean(state.muted[target]) : false));
  const audible = useBrowserMediaStore((state) =>
    target ? Boolean(state.audible[target]) : false,
  );
  // A muted page that has gone quiet keeps its icon so it can be unmuted.
  if (!target || (!audible && !muted)) return null;
  const label = muted ? "Unmute tab" : "Mute tab";
  const Icon = muted ? VolumeX : Volume2;
  return (
    <button
      type="button"
      className={props.className}
      aria-label={label}
      title={label}
      data-reorder-ignore="true"
      onClick={(event) => {
        event.stopPropagation();
        void useBrowserMediaStore.getState().toggleMuted(target);
      }}
    >
      <Icon className="size-3" size={12} aria-hidden="true" />
    </button>
  );
}
