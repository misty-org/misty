import type { ComponentProps } from "react";
import { BrowserOmniboxView } from "./BrowserOmniboxView";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
export * from "./BrowserOmniboxView";

/** The address bar, wired to the shared search panel. What is chosen there opens through `onNavigate`. */
export function BrowserOmnibox(
  props: Omit<ComponentProps<typeof BrowserOmniboxView>, "onOpenPanel"> & {
    onNavigate: (value: string) => void;
  },
) {
  return (
    <BrowserOmniboxView
      currentUrl={props.currentUrl}
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
