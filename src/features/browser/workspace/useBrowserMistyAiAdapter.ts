import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import {
  browserViewTitle,
  createBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import {
  browserContentHash,
  browserRuntimeCreated,
  browserRuntimeId,
  browserScopeId,
  useBrowserRuntimeStore,
  type BrowserMistyPage,
} from "@/features/webviews/browserRuntime";

/** Lets Misty read the attached page and propose one navigation or click for the user to review. */
export function useBrowserMistyAiAdapter(
  tab: WorkspaceView,
  mistyPage: BrowserMistyPage | null,
  nativeRuntime: boolean,
) {
  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const scopeId = browserScopeId(tab);
    const content = mistyPage
      ? [
          mistyPage.text.slice(0, 28 << 10),
          `Visible interactive controls (opaque references):\n${JSON.stringify(mistyPage.interactive)}`,
        ]
          .join("\n\n")
          .slice(0, 32 << 10)
      : "";
    const applicableAction = (artifact: AiArtifact) => {
      if (
        artifact.kind !== "browser_action" ||
        !nativeRuntime ||
        !browserRuntimeCreated(tab) ||
        !mistyPage ||
        artifact.baseRevision !== mistyPage.urlFingerprint
      )
        return null;
      const operations = artifact.operations as {
        tab_scope_id?: string;
        steps?: Array<{
          action?: string;
          target?: string;
          value?: string;
          effect?: string;
        }>;
      };
      if (operations.tab_scope_id !== scopeId || operations.steps?.length !== 1) return null;
      const step = operations.steps[0];
      if (step.action === "navigate" && typeof step.value === "string") {
        try {
          const url = new URL(step.value);
          return url.protocol === "https:" || url.protocol === "http:"
            ? {
                operation: "browser.navigate",
                input: {
                  url: url.toString(),
                },
              }
            : null;
        } catch {
          return null;
        }
      }
      if (
        step.action === "click" &&
        typeof step.target === "string" &&
        mistyPage.interactive.some((control) => control.ref === step.target)
      ) {
        return {
          operation: "browser.click",
          input: {
            elementRef: step.target,
            expectDownload: false,
          },
        };
      }
      return null;
    };
    return {
      surfaceId: "browser",
      label: mistyPage?.title || tab.title || "this browser tab",
      getContext: () => [
        {
          kind: "browser-tab",
          id: tab.id,
          title: mistyPage?.title || tab.title || "Browser tab",
          privacy: "device",
          opaqueScopeId: scopeId,
          revision: mistyPage?.urlFingerprint,
          attached: Boolean(mistyPage),
        },
      ],
      getSelection: () =>
        mistyPage
          ? {
              kind: "blocks",
              content,
              object: {
                kind: "browser-page",
                id: scopeId,
                revision: mistyPage.urlFingerprint,
              },
              anchors: {
                capture: "visible-page-text",
                truncated: mistyPage.truncated,
              },
              contentHash: browserContentHash(content),
            }
          : null,
      getSuggestedActions: () =>
        mistyPage
          ? [
              {
                id: "browser.summary",
                label: "Summarize page",
                prompt: "Summarize this page and cite the page context for the key claims.",
                trigger: "object",
              },
              {
                id: "browser.explain",
                label: "Explain page",
                prompt:
                  "Explain this page in plain language, including its main argument and caveats.",
                trigger: "object",
              },
              {
                id: "browser.extract",
                label: "Extract key facts",
                prompt:
                  "Extract the most important facts from this page. Separate page claims from your inference.",
                trigger: "object",
              },
              {
                id: "browser.next-action",
                label: "Review next action",
                prompt:
                  "Propose exactly one navigation or click using the current opaque tab scope and an explicitly listed control " +
                  "reference or URL. Explain the visible effect. Do not execute it.",
                trigger: "object",
                requestedArtifactKind: "browser_action",
              },
            ]
          : [],
      canApply: (artifact) => Boolean(applicableAction(artifact)),
      applyArtifact: async (artifact) => {
        const action = applicableAction(artifact);
        if (!action)
          throw new Error(
            "The page or browser scope changed. Ask your agent to regenerate this action.",
          );
        const grantId = `misty-action-${crypto.randomUUID()}`;
        const agentId = "misty-contextual-copilot";
        try {
          await invoke("browser_agent_grant_register", {
            request: {
              id: browserRuntimeId(tab),
              scopeId,
              grantId,
              agentId,
              capabilities: [action.operation],
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
            },
          });
          await invoke("browser_agent_execute", {
            request: {
              scopeId,
              grantId,
              agentId,
              operation: action.operation,
              input: action.input,
            },
          });
          if (action.operation === "browser.navigate") {
            const url = String(
              (
                action.input as {
                  url: string;
                }
              ).url,
            );
            useWorkspaceStore.getState().updateBrowserView(tab.id, {
              ...createBrowserViewState(url),
              title: browserViewTitle(url),
            });
            useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
          }
        } finally {
          await invoke("browser_agent_grant_revoke", {
            request: {
              id: browserRuntimeId(tab),
              grantId,
            },
          }).catch(() => undefined);
        }
      },
    };
  }, [mistyPage, nativeRuntime, tab]);
  useAiSurfaceAdapter(aiAdapter);
}
