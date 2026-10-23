import {
  browserOverlayReady,
  setBrowserWebviewsSuspended,
} from "@/features/webviews/browserRuntime";
import { useBrowserOverlay } from "./useBrowserOverlay";
const setOverlay = async (reason: string, active: boolean) => {
  setBrowserWebviewsSuspended(active, reason);
  await browserOverlayReady();
};
export function useBrowserOverlayControl(reason: string) {
  return useBrowserOverlay(reason, setOverlay);
}
