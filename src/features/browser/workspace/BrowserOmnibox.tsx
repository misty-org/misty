import type { ComponentProps } from "react";
import type { WorkspaceTab } from "@/features/workspace/model";
import {
  browserRuntimeId,
  browserOverlayReady,
  setBrowserWebviewsSuspended,
} from "./browserRuntime";
import { BrowserOmniboxView } from "./BrowserOmniboxView";
export * from "./BrowserOmniboxView";
const setOverlay = async (reason: string, active: boolean) => {
  setBrowserWebviewsSuspended(active, reason);
  await browserOverlayReady();
};
export function BrowserOmnibox(
  props: Omit<ComponentProps<typeof BrowserOmniboxView>, "suspensionReason" | "setOverlay"> & {
    tab: WorkspaceTab;
  },
) {
  return (
    <BrowserOmniboxView
      {...props}
      suspensionReason={`browser-omnibox:${browserRuntimeId(props.tab)}`}
      setOverlay={setOverlay}
    />
  );
}
