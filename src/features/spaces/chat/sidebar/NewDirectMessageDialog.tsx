import { useState } from "react";
import { spacesApi } from "../../api/api";
import type { SpaceConversation, SpaceMember } from "../../api/dto/entities";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Pressable } from "@/shared/ui";

/** Opens the DM with another person in the Space, starting it if there isn't one yet. */
export function NewDirectMessageDialog({
  spaceId,
  open,
  onOpenChange,
  members,
  currentUserId,
  onOpened,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SpaceMember[];
  currentUserId?: string;
  onOpened: (conversation: SpaceConversation) => void;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const others = members.filter((member) => member.user_id !== currentUserId);
  const openWith = async (userId: string) => {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      onOpened(await spacesApi.openDirectMessage(spaceId, userId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The message couldn't be opened.");
    } finally {
      setOpening(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
        </DialogHeader>
        <div className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto">
          {others.length ? (
            others.map((member) => (
              <Pressable
                key={member.user_id}
                disabled={opening}
                onClick={() => void openWith(member.user_id)}
                className="flex min-h-10 items-center rounded-md px-3 text-left text-sm text-cream hover:bg-charcoal-hover"
              >
                <span className="min-w-0 truncate">{member.name}</span>
              </Pressable>
            ))
          ) : (
            <p className="px-3 text-sm text-cream-muted">No one else is in this Space yet.</p>
          )}
        </div>
        {error ? (
          <SystemErrorNotice
            error={error}
            scope={`social:direct-message:${spaceId}`}
            title="Message could not be opened"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
