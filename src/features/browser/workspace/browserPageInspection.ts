import type { WorkspaceView } from "@/features/workspace";
import { invoke } from "@tauri-apps/api/core";
import {
  browserContentHash,
  browserRuntimeId,
  browserScopeId,
  type BrowserInspection,
  type BrowserMistyPage,
} from "./browserRuntime";

/**
 * Reads the open page for Misty through a two-minute, inspect-only grant that is
 * revoked as soon as the read finishes.
 */
export async function inspectBrowserPage(
  tab: WorkspaceView,
  url: string,
): Promise<BrowserMistyPage> {
  const grantId = `misty-page-${crypto.randomUUID()}`;
  const agentId = "misty-contextual-copilot";
  const scopeId = browserScopeId(tab);
  try {
    await invoke("browser_agent_grant_register", {
      request: {
        id: browserRuntimeId(tab),
        scopeId,
        grantId,
        agentId,
        capabilities: ["browser.inspect"],
        expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      },
    });
    const snapshot = await invoke<BrowserInspection>("browser_agent_execute", {
      request: {
        scopeId,
        grantId,
        agentId,
        operation: "browser.inspect",
        input: {},
      },
    });
    const text = String(snapshot.text ?? "").slice(0, 32 * 1024);
    if (!text.trim()) throw new Error("The page did not expose readable text.");
    return {
      title: String(snapshot.title || tab.title || "Browser page"),
      text,
      truncated: Boolean(snapshot.truncated) || String(snapshot.text ?? "").length > text.length,
      urlFingerprint: browserContentHash(String(snapshot.url || url)),
      interactive: (snapshot.interactive ?? []).slice(0, 100),
    };
  } finally {
    await invoke("browser_agent_grant_revoke", {
      request: {
        id: browserRuntimeId(tab),
        grantId,
      },
    }).catch(() => undefined);
  }
}
