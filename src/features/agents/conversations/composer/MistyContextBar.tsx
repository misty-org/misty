import { needsModelKey } from "../../models/ModelKeyNeeded";
import { openModelSettings } from "../../models/modelKeys";
import { ErrorNotice } from "../ErrorNotice";
import { useAiSurfaceStore } from "../../runs/invocations/store";
import { runtimeAiApi } from "@/features/agents/AgentsRuntime";
import { useEffect, useState } from "react";
import { useMistyStore } from "../state/useMistyStore";
import { requestHostContext } from "../context/contextBridge";
import { assertMistyAvailable } from "../state/availability";
import { Button, Text } from "@/shared/ui";

export function MistyContextBar() {
  const notice = useMistyStore((s) => s.handoff?.notice);
  const accountId = useMistyStore((s) => s.accountId);
  const selectedSpaceId = useMistyStore((s) => s.selectedSpaceId) || "";
  const pendingArtifact = useMistyStore((s) =>
    s.artifactConversationId === s.activeConversationId ? s.pendingArtifact : undefined,
  );
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const invocationId = useMistyStore((s) => s.invocationId);
  const working = useMistyStore((s) => s.working);
  const [undo, setUndo] = useState<{
    id: string;
    title: string;
    expiresAt: string;
    paneId: string;
  }>();
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState(false);
  useEffect(() => {
    setError("");
    setUndo(undefined);
  }, [accountId, activeConversationId]);
  // The undo goes away the moment it expires, not at the next unrelated render.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(
      () => setUndo(undefined),
      Math.max(0, Date.parse(undo.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [undo]);
  if (!pendingArtifact && !undo && !notice && !error) return null;
  return (
    <Text bare as="div" tone="muted" className="border-t px-4 py-3 text-xs">
      {working && invocationId && (
        <Button
          variant="quiet"
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
          <Text bare as="p" tone="default">
            {pendingArtifact.title}
          </Text>
          <p>{pendingArtifact.summary}</p>
          <details className="mt-1">
            <summary>Review proposed change</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(pendingArtifact.operations, null, 2)}
            </pre>
          </details>
          {(["accept", "reject"] as const).map((decision) => (
            <Button
              variant="quiet"
              key={decision}
              disabled={deciding}
              className="mr-3 mt-1"
              onClick={() => {
                if (deciding) return;
                setDeciding(true);
                setError("");
                const paneId =
                  decision === "accept" ? useMistyStore.getState().artifactPaneId : undefined;
                const run = (
                  decision === "reject"
                    ? Promise.resolve()
                    : assertMistyAvailable(accountId, selectedSpaceId)
                ).then<unknown>(() => {
                  return paneId
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
                      );
                });
                void run
                  .then((receipt) => {
                    if (
                      useMistyStore.getState().accountId !== accountId ||
                      useMistyStore.getState().activeConversationId !== activeConversationId
                    )
                      return;
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
                    const surface = useAiSurfaceStore.getState();
                    if (
                      decision === "reject" &&
                      surface.companion.accountId === accountId &&
                      surface.companion.approval?.artifact.id === pendingArtifact.id
                    )
                      surface.dismiss();
                    const current = useMistyStore.getState();
                    if (current.accountId !== accountId) return;
                    useMistyStore.setState({
                      conversations: current.conversations.map((conversation) => ({
                        ...conversation,
                        messages: conversation.messages.map((message) =>
                          message.artifact?.id === pendingArtifact.id
                            ? { ...message, artifact: undefined }
                            : message,
                        ),
                      })),
                      ...(current.pendingArtifact?.id === pendingArtifact.id
                        ? { pendingArtifact: undefined }
                        : {}),
                    });
                  })
                  .catch((reason) => setError(String(reason)))
                  .finally(() => setDeciding(false));
              }}
            >
              {decision === "accept" ? "Approve" : "Reject"}
            </Button>
          ))}
        </div>
      )}
      {undo && (
        <Button
          variant="quiet"
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
      <ErrorNotice
        message={error}
        action={
          needsModelKey(error)
            ? { label: "Open Models settings", onSelect: openModelSettings }
            : undefined
        }
        onDismiss={() => setError("")}
      />
    </Text>
  );
}
