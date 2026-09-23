import { runtimeAiApi } from "@/features/agents/agentsRuntime";
import { useState } from "react";
import { useMistyStore } from "./useMistyStore";
import { requestHostContext } from "./contextBridge";
import { assertMistyAvailable } from "./availability";
import { Button } from "@/shared/ui";

export function MistyContextBar() {
  const notice = useMistyStore((s) => s.handoff?.notice);
  const accountId = useMistyStore((s) => s.accountId);
  const selectedSpaceId = useMistyStore((s) => s.selectedSpaceId) || "";
  const pendingArtifact = useMistyStore((s) => s.pendingArtifact);
  const invocationId = useMistyStore((s) => s.invocationId);
  const working = useMistyStore((s) => s.working);
  const [undo, setUndo] = useState<{
    id: string;
    title: string;
    expiresAt: string;
    paneId: string;
  }>();
  const [error, setError] = useState("");
  if (!pendingArtifact && !undo && !notice && !error) return null;
  return (
    <div className="border-t border-charcoal-border px-4 py-3 text-xs text-cream-muted">
      {working && invocationId && (
        <Button
          variant="link"
          className="mt-1"
          onClick={() =>
            void runtimeAiApi
              .cancelInvocation(invocationId)
              .catch((reason) => setError(String(reason)))
          }
        >
          Cancel task
        </Button>
      )}
      {pendingArtifact && (
        <div className="mt-2">
          <p className="text-cream">{pendingArtifact.title}</p>
          <p>{pendingArtifact.summary}</p>
          <details className="mt-1">
            <summary>Review proposed change</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(pendingArtifact.operations, null, 2)}
            </pre>
          </details>
          {(["accept", "reject"] as const).map((decision) => (
            <Button
              variant="link"
              key={decision}
              className="mr-3 mt-1"
              onClick={() => {
                const paneId = useMistyStore.getState().artifactPaneId;
                const run = assertMistyAvailable(accountId, selectedSpaceId).then<unknown>(() =>
                  paneId
                    ? requestHostContext<
                        { id: string; title: string; expiresAt: string } | undefined
                      >({
                        accountId,
                        spaceId: selectedSpaceId,
                        targets: [],
                        paneId,
                        decision,
                        artifactId: pendingArtifact.id,
                      })
                    : runtimeAiApi.decideArtifact(
                        pendingArtifact.id,
                        decision,
                        `misty-${pendingArtifact.id}-${decision}`,
                      ),
                );
                void run
                  .then((receipt) => {
                    if (
                      paneId &&
                      receipt &&
                      typeof receipt === "object" &&
                      "id" in receipt &&
                      "title" in receipt &&
                      "expiresAt" in receipt &&
                      typeof receipt.id === "string" &&
                      typeof receipt.title === "string" &&
                      typeof receipt.expiresAt === "string"
                    )
                      setUndo({
                        id: receipt.id,
                        title: receipt.title,
                        expiresAt: receipt.expiresAt,
                        paneId,
                      });
                    useMistyStore.setState({ pendingArtifact: undefined });
                  })
                  .catch((reason) => setError(String(reason)));
              }}
            >
              {decision === "accept" ? "Approve" : "Reject"}
            </Button>
          ))}
        </div>
      )}
      {undo && Date.parse(undo.expiresAt) > Date.now() && (
        <Button
          variant="link"
          className="mt-2"
          onClick={() =>
            void requestHostContext({
              accountId,
              spaceId: selectedSpaceId,
              targets: [],
              paneId: undo.paneId,
              undoId: undo.id,
            })
              .then(() => setUndo(undefined))
              .catch((reason) => setError(String(reason)))
          }
        >
          {undo.title}
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="status" className="mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
