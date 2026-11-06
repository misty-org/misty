import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { SitePermissionDecision, SitePermissionKind } from "./sitePermissions";

/** A site asking for a permission, waiting in native code for the person's answer. */
export interface SitePermissionAsk {
  requestId: number;
  /** The tab's runtime id. */
  id: string;
  /** The frame that asked. */
  origin: string;
  /** The tab's own site. */
  topOrigin: string;
  kinds: SitePermissionKind[];
}

export const useSitePermissionAsks = create<{ asks: SitePermissionAsk[] }>(() => ({ asks: [] }));

export function addSitePermissionAsk(ask: SitePermissionAsk) {
  useSitePermissionAsks.setState(({ asks }) => ({ asks: [...asks, ask] }));
}

/** The first question open for a tab: the popup asks them one at a time. */
export function sitePermissionAskFor(id: string) {
  return useSitePermissionAsks.getState().asks.find((ask) => ask.id === id);
}

/**
 * Settles a question. `ask` means the popup was closed without an answer: the site is refused
 * this time and nothing is saved.
 */
export async function answerSitePermissionAsk(
  ask: SitePermissionAsk,
  decision: SitePermissionDecision,
) {
  useSitePermissionAsks.setState(({ asks }) => ({
    asks: asks.filter((open) => open.requestId !== ask.requestId),
  }));
  await invoke("browser_site_permission_answer", { requestId: ask.requestId, decision });
}

const kindNames: Record<SitePermissionKind, string> = {
  camera: "camera",
  microphone: "microphone",
  location: "location",
};

/** "example.com wants to use your camera and microphone". */
export function sitePermissionAskText(ask: SitePermissionAsk) {
  const site = ask.origin.replace(/^https?:\/\//, "");
  return `${site} wants to use your ${ask.kinds.map((kind) => kindNames[kind]).join(" and ")}`;
}
