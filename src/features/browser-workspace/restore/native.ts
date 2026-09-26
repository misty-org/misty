import { invoke } from "@tauri-apps/api/core";

export interface RestoreReport {
  status: "restored" | "partial" | "none" | "skipped";
  applied: number;
  secrets: number;
  agent_fields: { key: string; label: string; kind: string; value: unknown }[];
  withheld: number;
  url: string;
}
export interface PageControl {
  ref: string;
  role: "field" | "action";
  tag: string;
  type: string;
  label: string;
  text: string;
  placeholder: string;
  withheld?: boolean;
}
export interface RestoreAction {
  type: "click" | "type" | "select" | "check" | "scroll" | "done";
  ref?: string;
  value?: unknown;
  dy?: number;
}

/** Field values never come back to the renderer from capture. */
export const capturePageState = (
  runtimeId: string,
  tabId: string,
  excluded: boolean,
  force: boolean,
) =>
  invoke<boolean>("browser_page_state_capture", { request: { runtimeId, tabId, excluded, force } });
export const restorePageState = (runtimeId: string, tabId: string) =>
  invoke<RestoreReport>("browser_page_state_restore", { request: { runtimeId, tabId } });
export const pageControls = (runtimeId: string) =>
  invoke<PageControl[]>("browser_page_state_controls", { runtimeId });
export const pageAct = (runtimeId: string, action: RestoreAction) =>
  invoke<{ ok: boolean; error?: string }>("browser_page_state_act", { runtimeId, action });
/** Returns the time of the user's last real input on the page. */
export const guardPage = (runtimeId: string, on: boolean) =>
  invoke<number>("browser_page_state_guard", { runtimeId, on });
