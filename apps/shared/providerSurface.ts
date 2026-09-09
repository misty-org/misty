import type {
  MistyAiArtifact,
  MistyBrowserInspection,
  MistySurfaceAdapter,
} from "@misty/sdk";
import { createProviderTools } from "./providerTools";

export function providerSurface(input: {
  appId: "chat" | "inbox" | "journal" | "planner" | "library";
  label: string;
  contextId: string;
  instanceId: string;
  page: MistyBrowserInspection;
  tools: ReturnType<typeof createProviderTools>;
  applied(): void;
}): MistySurfaceAdapter {
  const communication = input.appId === "chat" || input.appId === "inbox";
  const draft = (artifact: MistyAiArtifact) => {
    if (!communication) return null;
    if (
      artifact.kind !== "browser_action" ||
      artifact.baseRevision !== input.page.documentId
    )
      return null;
    const operations = artifact.operations as {
      tab_scope_id?: string;
      steps?: { action?: string; target?: string; value?: string }[];
    } | null;
    if (
      operations?.tab_scope_id !== input.contextId ||
      operations.steps?.length !== 1
    )
      return null;
    const step = operations.steps[0];
    if (
      step.action !== "type" ||
      typeof step.value !== "string" ||
      step.value.length > 20000 ||
      !input.page.interactive.some((control) => control.ref === step.target)
    )
      return null;
    return { elementRef: step.target!, text: step.value };
  };
  return {
    surfaceId:
      input.appId === "chat"
        ? "space.chat"
        : input.appId === "inbox"
          ? "inbox"
          : "browser",
    label: input.label,
    getContext: () => [
      {
        kind: "browser-tab",
        id: input.instanceId,
        title: input.label,
        privacy: "device",
        opaqueScopeId: input.contextId,
        revision: input.page.documentId,
        attached: true,
      },
    ],
    getSelection: () => ({
      kind: "blocks",
      content:
        `${input.page.text.slice(0, 28000)}\nVisible controls: ${JSON.stringify(input.page.interactive.slice(0, 100))}`.slice(
          0,
          32000,
        ),
      contentHash: input.page.documentId,
      object: {
        kind: "browser-page",
        id: input.contextId,
        revision: input.page.documentId,
      },
      anchors: {
        contentTrust: "untrusted-web-page",
        capture: "visible-page-only",
        truncated: true,
      },
    }),
    getSuggestedActions: () => [
      {
        id: `${input.appId === "chat" ? "social" : "mail"}.read`,
        label: "Summarize visible page",
        prompt:
          "Summarize only this attached visible provider page. Do not claim access to full history or other accounts.",
        trigger: "object",
      },
      ...(communication
        ? [
            {
              id: `${input.appId === "chat" ? "social" : "mail"}.draft`,
              label: "Prepare reply",
              prompt:
                "Prepare a reply for the visible conversation. Propose exactly one browser_action type step with a currently inspected editable control reference and the draft as value. Include the current tab_scope_id and document revision. Preparing text must not send it; the user will send in the provider website.",
              requestedArtifactKind: "browser_action" as const,
              trigger: "object" as const,
            },
          ]
        : []),
    ],
    canApply: (artifact) => !!draft(artifact),
    async applyArtifact(artifact) {
      const operation = draft(artifact);
      if (!operation)
        throw new Error(
          "Read the current provider page before preparing this draft.",
        );
      try {
        await input.tools.draft(
          input.page,
          operation.elementRef,
          operation.text,
        );
      } finally {
        input.applied();
      }
    },
  };
}
