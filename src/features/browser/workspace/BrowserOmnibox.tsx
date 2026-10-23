import type { ComponentProps } from "react";
import { dockLeaves, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { BrowserOmniboxView } from "./BrowserOmniboxView";
import { useBrowserSearchStore } from "@/features/browser-sync/search";

/** The address bar, wired to the shared search panel. What is chosen there opens through `onNavigate`. */
export function BrowserOmnibox(
  props: Omit<ComponentProps<typeof BrowserOmniboxView>, "onOpenPanel"> & {
    onNavigate: (value: string) => void;
  },
) {
  const currentUrl = useWorkspaceStore((state) => {
    if (!props.hostOnly) return props.currentUrl;
    const pane = dockLeaves(state.layout.root).find(
      (candidate) => candidate.id === state.layout.focusedPaneId,
    );
    const view = pane?.views.find((candidate) => candidate.id === pane.activeViewId);
    return view?.surfaceId === "browser"
      ? parseBrowserViewState(view.state).url
      : props.currentUrl;
  });

  return (
    <BrowserOmniboxView
      currentUrl={currentUrl}
      focusRequest={props.focusRequest}
      trailing={props.trailing}
      leading={props.leading}
      hostOnly={props.hostOnly}
      onOpenPanel={(field) =>
        useBrowserSearchStore.getState().show({
          left: field.left,
          top: field.top,
          // The sidebar's field is narrow; the panel matches it instead of widening to a desktop-sized box.
          width: Math.min(
            Math.max(field.width, props.hostOnly ? 320 : 480),
            window.innerWidth - 16,
          ),
          openUrl: (url) => props.onNavigate(url),
        })
      }
    />
  );
}
