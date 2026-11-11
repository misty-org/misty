import type { ComponentProps } from "react";
import { dockLeaves, parseBrowserViewState, useWorkspaceStore } from "@/features/app-windows";
import { BrowserOmniboxView } from "./BrowserOmniboxView";
import { useBrowserSearchStore } from "../search/search";

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
    return view?.surfaceId === "browser" ? parseBrowserViewState(view.state).url : props.currentUrl;
  });

  return (
    <BrowserOmniboxView
      currentUrl={currentUrl}
      focusRequest={props.focusRequest}
      trailing={props.trailing}
      leading={props.leading}
      hostOnly={props.hostOnly}
      onOpenPanel={(field) => {
        // The panel is the field grown, so it opens exactly over the field.
        useBrowserSearchStore.getState().show({
          left: field.left,
          top: field.top,
          width: Math.min(field.width, window.innerWidth - 16),
          openUrl: (url) => props.onNavigate(url),
        });
      }}
    />
  );
}
