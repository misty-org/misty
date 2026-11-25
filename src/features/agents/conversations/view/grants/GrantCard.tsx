// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState } from "react";
import { Check, FolderLock, RotateCcw, X } from "lucide-react";
import { Button, QuestionPanel, Surface, Text } from "@misty/ui";
import type { FolderGrant, GlobalAiMessage } from "../../state/conversation_types";
import { folderGrantScope, patchFolderGrant, requestFolderGrant } from "./folder_grants";

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
    <div className="mt-3 grid max-w-[85%] gap-2">
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
      if (dir) patch({ status: "granted", dir });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <QuestionPanel
      label="Folder access"
      title={
        <Text bare size="control" tone="bright" weight="medium" className="flex items-center gap-2">
          <Text bare tone="muted" className="flex flex-none">
            <FolderLock aria-hidden="true" />
          </Text>
          {grant.path ? "Folder access needed" : "Access needed"}
        </Text>
      }
      error={error}
      actions={
        grant.status === "pending" ? (
          <>
            {grant.path ? (
              <Button variant="primary" disabled={busy} onClick={() => void allow()}>
                <Check aria-hidden="true" />
                Allow folder
              </Button>
            ) : null}
            <Button variant="quiet" disabled={busy} onClick={() => patch({ status: "declined" })}>
              <X aria-hidden="true" />
              {grant.path ? "Decline" : "Dismiss"}
            </Button>
          </>
        ) : grant.status === "granted" ? (
          <>
            <Text size="meta" tone="muted">
              Agents can now work in this folder.
            </Text>
            {retryPrompt ? (
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => onRetry(retryPrompt, retryFrom)}
              >
                <RotateCcw aria-hidden="true" />
                Retry
              </Button>
            ) : null}
          </>
        ) : (
          <Text size="meta" tone="muted">
            Not allowed
          </Text>
        )
      }
    >
      {grant.message ? (
        <Text size="meta" tone="muted" wrap>
          {grant.message}
        </Text>
      ) : null}
      {grant.path ? (
        <Surface tone="faint" radius="lg" className="px-3 py-2">
          <Text size="meta" tone="muted" wrap as="div">
            {grant.dir ?? grant.path}
          </Text>
        </Surface>
      ) : null}
    </QuestionPanel>
  );
}
