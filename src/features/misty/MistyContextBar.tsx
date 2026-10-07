import { useAiSurfaceStore } from "@/features/ai-surface/store";
import { runtimeAiApi } from "@/features/agents/AgentsRuntime";
import { useEffect, useState } from "react";
import { useMistyStore } from "./useMistyStore";
import { requestHostContext } from "./contextBridge";
import { assertMistyAvailable } from "./availability";
import { restoreOrganizationProposal, useFolderOrganization } from "./folderOrganization";
import { Button } from "@/shared/ui";

export function MistyContextBar() {
  const notice = useMistyStore((s) => s.handoff?.notice);
  const accountId = useMistyStore((s) => s.accountId);
  const selectedSpaceId = useMistyStore((s) => s.selectedSpaceId) || "";
  const pendingArtifact = useMistyStore((s) =>
    s.artifactConversationId === s.activeConversationId ? s.pendingArtifact : undefined,
  );
  const activeConversationId = useMistyStore((s) => s.activeConversationId);
  const [restoring, setRestoring] = useState(false);
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
  const folder = useFolderOrganization((state) =>
    state.accountId === accountId && state.snapshot?.grantId === pendingArtifact?.target?.id
      ? state.snapshot
      : undefined,
  );
  useEffect(() => {
    setError("");
    setUndo(undefined);
  }, [accountId, activeConversationId]);
  useEffect(() => {
    if (pendingArtifact?.kind !== "file_plan") return;
    let active = true;
    setRestoring(true);
    void restoreOrganizationProposal(accountId, pendingArtifact)
      .catch((reason) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, pendingArtifact]);
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
            {pendingArtifact.kind === "file_plan" ? (
              folder ? (
                <ol className="mt-2 max-h-48 list-decimal overflow-auto pl-5">
                  {(
                    (
                      pendingArtifact.operations as {
                        steps?: Array<{
                          action?: string;
                          source_scope_id?: string;
                          display_name?: string;
                        }>;
                      }
                    ).steps ?? []
                  ).map((step, index) => (
                    <li key={index} className="py-1 break-words">
                      {step.action === "mkdir"
                        ? "Create folder"
                        : (folder.items.find((item) => item.id === step.source_scope_id)
                            ?.relativePath ?? "Selected file")}{" "}
                      → {step.display_name}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2" role="status">
                  {restoring
                    ? "Restoring access to the selected folder…"
                    : "Folder access is unavailable on this device. Choose a folder and request a new proposal."}
                </p>
              )
            ) : (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(pendingArtifact.operations, null, 2)}
              </pre>
            )}
          </details>
          {(["accept", "reject"] as const).map((decision) => (
            <Button
              variant="link"
              key={decision}
              disabled={
                deciding ||
                (decision === "accept" &&
                  (restoring || (pendingArtifact.kind === "file_plan" && !folder)))
              }
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
                  if (decision === "accept" && pendingArtifact.kind === "file_plan" && !paneId)
                    throw new Error("Restore access to this folder before approving changes.");
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
                      pendingArtifact.kind !== "file_plan" &&
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
