import type { ComponentType } from "react";
import type { WorkspaceView } from "@/features/app-windows";
import { createPort } from "@/shared/lib/seams";
import type { BrowserMistyPage } from "../webviews/browserRuntime";
import type { BrowserAskSnapshot } from "../webviews/browserAsk";

/** What the browser asks of agents: the toolbar button and the page tools that talk to Misty. */
export interface BrowserAgents {
  AgentsButton: ComponentType;
  /** Opens the Agents panel, for the menu row that sits beside the toolbar button. */
  openAgentsPanel?(): void;
  translatePageWithMisty(tab: WorkspaceView, url: string): Promise<void>;
  useBrowserMistyAiAdapter(
    tab: WorkspaceView,
    mistyPage: BrowserMistyPage | null,
    nativeRuntime: boolean,
  ): void;
  openBrowserAsk(snapshot: BrowserAskSnapshot): Promise<void>;
}

/** Agents sit above the browser, so they fill this in once at startup (see `app/featureSeams`). */
export const browserAgents = createPort<BrowserAgents>("agents in the browser");

export function BrowserAgentsButton() {
  const Button = browserAgents.maybe()?.AgentsButton;
  return Button ? <Button /> : null;
}

export function openAgentsPanel(): void {
  browserAgents.maybe()?.openAgentsPanel?.();
}

export function translatePageWithMisty(tab: WorkspaceView, url: string): Promise<void> {
  return browserAgents.get().translatePageWithMisty(tab, url);
}

const noAdapter: BrowserAgents["useBrowserMistyAiAdapter"] = () => undefined;

export function useBrowserMistyAiAdapter(
  tab: WorkspaceView,
  mistyPage: BrowserMistyPage | null,
  nativeRuntime: boolean,
): void {
  const useAdapter = browserAgents.maybe()?.useBrowserMistyAiAdapter ?? noAdapter;
  useAdapter(tab, mistyPage, nativeRuntime);
}
