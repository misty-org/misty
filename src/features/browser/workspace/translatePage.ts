import { useMistyPanelStore } from "@/features/agents";
import type { AiSelectionSnapshot } from "@/features/ai-surface/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import type { WorkspaceView } from "@/features/workspace";
import { browserContentHash, browserScopeId } from "./browserRuntime";
import { inspectBrowserPage } from "./browserPageInspection";

/** The person's language by name, such as "English", from the app's locale. */
function readerLanguage(): string {
  const locale = navigator.language || "en";
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(locale.split("-")[0]) ?? locale;
  } catch {
    return locale;
  }
}

/**
 * Translates the page with Misty: the page's text is attached and Misty answers
 * in the panel beside it, through the same metered gateway as every request.
 */
export async function translatePageWithMisty(tab: WorkspaceView, url: string): Promise<void> {
  const page = await inspectBrowserPage(tab, url);
  const content = page.text.slice(0, 32 << 10);
  const selection: AiSelectionSnapshot = {
    kind: "blocks",
    content,
    object: { kind: "browser-page", id: browserScopeId(tab), revision: page.urlFingerprint },
    anchors: { capture: "visible-page-text", truncated: page.truncated },
    contentHash: browserContentHash(content),
  };
  useMistyPanelStore.getState().setOpen(true);
  const language = readerLanguage();
  await useMistyStore
    .getState()
    .submitAnswer(
      `Translate this page into ${language}. Keep its headings, lists and paragraph breaks, ` +
        "translate only the page's own text, and first say which language it was written in.",
      [],
      selection,
      "panel",
    );
}
