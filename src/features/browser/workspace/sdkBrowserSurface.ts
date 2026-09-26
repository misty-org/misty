import type {
  MistyAiArtifact,
  MistyBrowserInspection,
  MistyBrowserSDK,
  MistySurfaceAdapter,
} from "@misty/sdk";

export function sdkBrowserSurface(input: {
  browser: MistyBrowserSDK;
  instanceId: string;
  handle: string;
  contextId: string;
  page: MistyBrowserInspection | null;
  applied(): void;
}): MistySurfaceAdapter {
  const { page } = input;
  const content = page
    ? [
        page.text.slice(0, 28 << 10),
        `Visible interactive controls (opaque references):\n${JSON.stringify(page.interactive.slice(0, 100))}`,
      ]
        .join("\n\n")
        .slice(0, 32 << 10)
    : "";
  const action = (artifact: MistyAiArtifact) => {
    if (!page || artifact.kind !== "browser_action" || artifact.baseRevision !== page.documentId)
      return null;
    const operations = artifact.operations as {
      tab_scope_id?: string;
      steps?: Array<{ action?: string; target?: string; value?: string }>;
    } | null;
    if (operations?.tab_scope_id !== input.contextId || operations.steps?.length !== 1) return null;
    const step = operations.steps[0];
    if (step.action === "navigate" && typeof step.value === "string") {
      try {
        const url = new URL(step.value);
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
          return { kind: "navigate" as const, value: url.href };
      } catch {
        /* Invalid URLs cannot be applied. */
      }
    }
    if (
      step.action === "click" &&
      typeof step.target === "string" &&
      page.interactive.some((control) => control.ref === step.target)
    )
      return { kind: "click" as const, value: step.target };
    return null;
  };
  return {
    surfaceId: "browser",
    label: page?.title || "Browser tab",
    getContext: () => [
      {
        kind: "browser-tab",
        id: input.instanceId,
        title: page?.title || "Browser tab",
        privacy: "device",
        opaqueScopeId: input.contextId,
        revision: page?.documentId,
        attached: !!page,
      },
    ],
    getSelection: () =>
      page
        ? {
            kind: "blocks",
            content,
            object: { kind: "browser-page", id: input.contextId, revision: page.documentId },
            anchors: {
              capture: "visible-page-text",
              truncated: page.truncated || page.text.length > 28 << 10,
              contentTrust: "untrusted-web-page",
            },
            contentHash: page.documentId,
          }
        : null,
    getSuggestedActions: () =>
      page
        ? [
            {
              id: "browser.summary",
              label: "Summarize page",
              prompt: "Summarize this page and cite the page context for key claims.",
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
              prompt: "Extract the key facts. Separate page claims from your inference.",
              trigger: "object",
            },
            {
              id: "browser.next-action",
              label: "Review next action",
              prompt:
                "Propose exactly one navigation or click using the current opaque tab scope and a listed control reference or URL. Explain the visible effect. Do not execute it.",
              trigger: "object",
              requestedArtifactKind: "browser_action",
            },
          ]
        : [],
    canApply: (artifact) => !!action(artifact),
    async applyArtifact(artifact) {
      const next = action(artifact);
      if (!next || !page) throw new Error("Inspect this page again before applying an action.");
      try {
        if (next.kind === "navigate") await input.browser.navigate(input.handle, next.value);
        else await input.browser.click(input.handle, page.documentId, next.value);
      } finally {
        input.applied();
      }
    },
  };
}
