// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import "./grantCard.css";
import { useEffect, useState } from "react";
import { Check, FolderLock, RotateCcw, X } from "lucide-react";
import { Button } from "@/shared/ui";
import type { FolderGrant, GlobalAiMessage } from "../../state/conversationTypes";
import { folderGrantScope, patchFolderGrant, requestFolderGrant } from "./folderGrants";

/**
 * The engine refused a call on a folder outside the ones it may use, and can't unblock itself:
 * its "approve it in the terminal" refers to a prompt that doesn't exist here. This card is the
 * real answer: allow the folder (native code asks the person and links it to the Space), then
 * retry the turn, or decline.
 */
export function GrantCards(props: {
  conversationId?: string;
  message: GlobalAiMessage;
  working: boolean;
  retryPrompt?: string;
  retryFrom?: string;
  onRetry: (prompt: string, fromMessageId?: string) => void;
}) {
  const grants = props.message.folderGrants ?? [];
  return (
    <div className="agent-grant-list">
      {grants.map((grant) => (
        <GrantCard key={grant.id} grant={grant} {...props} />
      ))}
    </div>
  );
}

function GrantCard({
  grant,
  conversationId,
  message,
  working,
  retryPrompt,
  retryFrom,
  onRetry,
}: Parameters<typeof GrantCards>[0] & { grant: FolderGrant }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (change: Partial<FolderGrant>) =>
    conversationId && patchFolderGrant(conversationId, message.id, grant.id, change);
  // Show the folder allowing it would cover before anyone answers.
  useEffect(() => {
    if (!grant.path || grant.dir || grant.status !== "pending") return;
    let live = true;
    void folderGrantScope(grant.path)
      .then((dir) => live && patch({ dir }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.path, grant.dir, grant.status]);
  const allow = async () => {
    if (!grant.path) return;
    setBusy(true);
    setError("");
    try {
      const dir = await requestFolderGrant(grant.path);
      // Cancelling the system dialog leaves the card open to answer again.
      if (dir) patch({ status: "granted", dir });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="agent-grant-card" aria-label="Folder access">
      <p className="agent-grant-title">
        <FolderLock aria-hidden="true" />
        {grant.path ? "Folder access needed" : "Access needed"}
      </p>
      {grant.message ? <p className="agent-grant-message">{grant.message}</p> : null}
      {grant.path ? <code className="agent-grant-path">{grant.dir ?? grant.path}</code> : null}
      {error ? <p className="agent-grant-message">{error}</p> : null}
      {grant.status === "pending" ? (
        <div className="agent-grant-actions">
          {grant.path ? (
            <Button size="sm" disabled={busy} onClick={() => void allow()}>
              <Check aria-hidden="true" />
              Allow folder
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => patch({ status: "declined" })}
          >
            <X aria-hidden="true" />
            {grant.path ? "Decline" : "Dismiss"}
          </Button>
        </div>
      ) : grant.status === "granted" ? (
        <div className="agent-grant-actions">
          <span className="agent-grant-done">Agents can now work in this folder.</span>
          {retryPrompt ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={working}
              onClick={() => onRetry(retryPrompt, retryFrom)}
            >
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="agent-grant-done">Not allowed</p>
      )}
    </section>
  );
}
