import { spacesApi } from "@/api/spaces/api";
import { SystemErrorNotice } from "@/features/support/systemErrors";
import type { SpaceConversation } from "@/api/spaces/dto/entities";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { useEffect, useState, type FormEvent } from "react";

/** Creates or renames a group chat, which is public to the Space, so it has no member list. */
export function CreateEditConversationDialog({
  spaceId,
  open,
  onOpenChange,
  conversation,
  onSaved,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when renaming an existing channel; absent when creating one. */
  conversation?: SpaceConversation | null;
  onSaved: (conversation: SpaceConversation) => void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setTitle(conversation?.title ?? "");
  }, [open, conversation]);

  const canSave = Boolean(title.trim()) && !saving;

  const close = () => {
    if (saving) return;
    onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const name = title.trim().slice(0, 80);
      const saved = conversation
        ? await spacesApi.updateConversation(spaceId, conversation.id, name)
        : await spacesApi.createConversation(spaceId, name);
      onSaved(saved);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The channel could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{conversation ? "Rename channel" : "New channel"}</DialogTitle>
          </DialogHeader>
          <label className="mt-5 grid gap-2 text-xs font-medium text-cream-muted">
            Name
            <Input
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error ? (
            <SystemErrorNotice
              error={error}
              scope={`social:conversation:${spaceId}`}
              title="Channel could not be saved"
            />
          ) : null}
          <DialogFooter className="mt-5">
            <Button variant="outline" type="button" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {conversation ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
