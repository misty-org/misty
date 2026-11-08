import { invoke } from "@tauri-apps/api/core";

interface RestoreReport {
  status: "restored" | "partial" | "none" | "skipped";
  applied: number;
  secrets: number;
  withheld: number;
  url: string;
}

/** Field values never come back to the renderer from capture. */
export const capturePageState = (
  runtimeId: string,
  viewId: string,
  excluded: boolean,
  force: boolean,
) =>
  invoke<boolean>("browser_page_state_capture", {
    request: { runtimeId, viewId, excluded, force },
  });
export const restorePageState = (runtimeId: string, viewId: string) =>
  invoke<RestoreReport>("browser_page_state_restore", { request: { runtimeId, viewId } });
