import type { ComponentProps } from "react";
import { browserOverlayReady, setBrowserWebviewsSuspended } from "./browserRuntime";
import { BrowserViewportMenuView } from "./BrowserViewportMenuView";
export * from "./BrowserViewportMenuView";
const setOverlay = async (reason: string, active: boolean) => {
  setBrowserWebviewsSuspended(active, reason);
  await browserOverlayReady();
};
export function BrowserViewportMenu(
  props: Omit<ComponentProps<typeof BrowserViewportMenuView>, "setOverlay">,
) {
  return <BrowserViewportMenuView {...props} setOverlay={setOverlay} />;
}
