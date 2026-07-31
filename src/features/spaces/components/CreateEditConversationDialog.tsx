import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Checkbox } from "@/ui";
import { Input } from "@/ui";
import { Button } from "@/ui";
import type { SpaceConversation, SpaceMember } from "@/models/interfaces/features/spaces/types";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";

export function CreateEditConversationDialog({
  spaceId,
  open,
  onOpenChange,
  members,
  currentUserId,
  conversation,
  onSaved,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SpaceMember[];
  currentUserId?: string;
  /** Present when editing an existing conversation; absent when creating one. */
  conversation?: SpaceConversation | null;
  onSaved: (conversation: SpaceConversation) => void;
}) {
  const [title, setTitle] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setTitle(conversation?.title ?? "");
    setSelectedMemberIds(
      conversation?.members
        .filter((member) => member.user_id !== currentUserId)
        .map((member) => member.user_id) ?? [],
    );
  }, [open, conversation, currentUserId]);

  const otherMembers = members.filter((member) => member.user_id !== currentUserId);
  const canSave = selectedMemberIds.length > 0 && !saving;

  const close = () => {
    if (saving) return;
    onOpenChange(false);
  };

  const toggleMember = (memberId: string, checked: boolean) => {
    setSelectedMemberIds((current) =>
      checked ? [...current, memberId] : current.filter((id) => id !== memberId),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const selectedNames = selectedMemberIds
        .map((memberId) => otherMembers.find((member) => member.user_id === memberId)?.name)
        .filter((name): name is string => Boolean(name));
      const resolvedTitle = (title.trim() || selectedNames.join(", ") || "Conversation").slice(
        0,
        80,
      );
      const saved = conversation
        ? await spacesApi.updateConversation(
            spaceId,
            conversation.id,
            resolvedTitle,
            selectedMemberIds,
          )
        : await spacesApi.createConversation(spaceId, resolvedTitle, selectedMemberIds);
      onSaved(saved);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The conversation could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-sm">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{conversation ? "Edit conversation" : "New conversation"}</DialogTitle>
            <DialogDescription>
              Choose one or more members. You can change the people in this conversation later.
            </DialogDescription>
          </DialogHeader>
          <label className="mt-5 grid gap-2 text-xs font-medium text-muted-foreground">
            Name <span className="font-normal text-muted-foreground/75">(optional)</span>
            <Input
              maxLength={80}
              placeholder="Uses member names when left blank"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <fieldset className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto border-0 p-0">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Members</legend>
            {otherMembers.map((member) => (
              <label
                className="flex min-h-10 items-center gap-3 rounded-md px-3 text-xs hover:bg-accent"
                key={member.user_id}
              >
                <Checkbox
                  checked={selectedMemberIds.includes(member.user_id)}
                  onCheckedChange={(checked) => toggleMember(member.user_id, Boolean(checked))}
                />
                <span className="min-w-0">
                  <span className="block truncate text-foreground">{member.name}</span>
                  <span className="block truncate text-[9px] text-muted-foreground">
                    {member.email}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p
              className="mb-0 mt-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="mt-5">
            <Button variant="outline" type="button" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? "Saving..." : conversation ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
