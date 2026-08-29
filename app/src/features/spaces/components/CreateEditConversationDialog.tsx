import { spacesApi } from "@/api/spaces/api";
import { SystemErrorActivity } from "@/features/activity";
import type {
  SpaceActorRef,
  SpaceAgentMembership,
  SpaceConversation,
  SpaceMember,
} from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { useEffect, useState, type FormEvent } from "react";

export function CreateEditConversationDialog({
  spaceId,
  open,
  onOpenChange,
  members,
  agents: _agents,
  currentUserId,
  conversation,
  onSaved,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  currentUserId?: string;
  /** Present when editing an existing conversation; absent when creating one. */
  conversation?: SpaceConversation | null;
  onSaved: (conversation: SpaceConversation) => void;
}) {
  const [title, setTitle] = useState("");
  const [selectedActors, setSelectedActors] = useState<SpaceActorRef[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setTitle(conversation?.title ?? "");
    setSelectedActors(
      conversation?.participants
        .filter((participant) => participant.user_id !== currentUserId)
        .flatMap((participant): SpaceActorRef[] =>
          participant.kind === "person" && participant.user_id
            ? [{ kind: "person", user_id: participant.user_id }]
            : [],
        ) ?? [],
    );
  }, [open, conversation, currentUserId]);

  const otherMembers = members.filter((member) => member.user_id !== currentUserId);
  const canSave = selectedActors.length > 0 && !saving;

  const close = () => {
    if (saving) return;
    onOpenChange(false);
  };

  const actorKey = (actor: SpaceActorRef) =>
    actor.kind === "agent" ? `agent:${actor.agent_id}` : `person:${actor.user_id}`;
  const toggleActor = (actor: SpaceActorRef, checked: boolean) => {
    const key = actorKey(actor);
    setSelectedActors((current) =>
      checked ? [...current, actor] : current.filter((item) => actorKey(item) !== key),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const selectedNames = selectedActors
        .map((actor) =>
          actor.kind === "person"
            ? otherMembers.find((member) => member.user_id === actor.user_id)?.name
            : undefined,
        )
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
            selectedActors,
          )
        : await spacesApi.createConversation(spaceId, resolvedTitle, selectedActors);
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
              Choose the people in this conversation. Agents join through explicit mentions.
            </DialogDescription>
          </DialogHeader>
          <label className="mt-5 grid gap-2 text-xs font-medium text-cream-muted">
            Name <span className="font-normal text-cream-muted/75">(optional)</span>
            <Input
              maxLength={80}
              placeholder="Uses member names when left blank"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <fieldset className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto border-0 p-0">
            <legend className="mb-2 text-xs font-medium text-cream-muted">Participants</legend>
            {otherMembers.map((member) => (
              <label
                className="flex min-h-10 items-center gap-3 rounded-md px-3 text-xs hover:bg-charcoal-hover"
                key={member.user_id}
              >
                <Checkbox
                  checked={selectedActors.some(
                    (actor) => actor.kind === "person" && actor.user_id === member.user_id,
                  )}
                  onCheckedChange={(checked) =>
                    toggleActor({ kind: "person", user_id: member.user_id }, Boolean(checked))
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-cream">{member.name}</span>
                  <span className="block truncate text-[9px] text-cream-muted">{member.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <SystemErrorActivity
              error={error}
              scope={`social:conversation:${spaceId}`}
              title="Conversation could not be saved"
              target={{ kind: "space-chat", spaceId }}
            />
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
