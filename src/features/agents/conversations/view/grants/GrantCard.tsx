// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useState } from "react";
import { Check, FolderLock, RotateCcw, X } from "lucide-react";
import { Button, Surface, Text } from "@/shared/ui";
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
    <div className="mt-3 grid gap-2">
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
    <Surface
      as="section"
      tone="card"
      edge="hairline"
      radius="xl"
      className="grid max-w-[85%] gap-2 px-3.5 py-3"
      aria-label="Folder access"
    >
      <Text
        as="p"
        bare
        size="meta"
        weight="medium"
        tone="default"
        className="m-0 flex items-center gap-1.5"
      >
        <Text bare tone="muted" className="flex flex-none">
          <FolderLock aria-hidden="true" />
        </Text>
        {grant.path ? "Folder access needed" : "Access needed"}
      </Text>
      {grant.message ? (
        <Text size="meta" tone="muted" wrap>
          {grant.message}
        </Text>
      ) : null}
      {grant.path ? (
        <Surface tone="page" radius="md" className="px-2 py-1">
          <Text size="caption" tone="muted" wrap as="div">
            {grant.dir ?? grant.path}
          </Text>
        </Surface>
      ) : null}
      {error ? (
        <Text size="meta" tone="muted" wrap>
          {error}
        </Text>
      ) : null}
      {grant.status === "pending" ? (
        <div className="flex items-center gap-2">
          {grant.path ? (
            <Button disabled={busy} onClick={() => void allow()}>
              <Check aria-hidden="true" />
              Allow folder
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={() => patch({ status: "declined" })}>
            <X aria-hidden="true" />
            {grant.path ? "Decline" : "Dismiss"}
          </Button>
        </div>
      ) : grant.status === "granted" ? (
        <div className="flex items-center gap-2">
          <Text size="meta" tone="muted" wrap as="span">
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
        </div>
      ) : (
        <Text size="meta" tone="muted" wrap>
          Not allowed
        </Text>
      )}
    </Surface>
  );
}
