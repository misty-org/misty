import { useState } from "react";
import { spacesApi } from "../../api/api";
import type { SpaceConversation, SpaceMember } from "../../api/dto/entities";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListRow,
  Text,
} from "@misty/ui";

/** The most other people a group DM takes; the server's limit is ten with the person who starts it. */
const maxOthers = 9;

/**
 * Starts a direct message. Pick one person for the DM with them (opened, or started if there isn't one
 * yet); pick several and a new group DM is made with all of them.
 */
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
  const [picked, setPicked] = useState<string[]>([]);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const others = members.filter((member) => member.user_id !== currentUserId);
  const toggle = (userId: string) =>
    setPicked((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  const start = async () => {
    if (opening || !picked.length) return;
    setOpening(true);
    setError("");
    try {
      const opened =
        picked.length === 1
          ? await spacesApi.openDirectMessage(spaceId, picked[0]!)
          : await spacesApi.openGroupDirectMessage(spaceId, picked);
      setPicked([]);
      onOpened(opened);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The message couldn't be opened.");
    } finally {
      setOpening(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPicked([]);
        onOpenChange(next);
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
        </DialogHeader>
        <div className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto">
          {others.length ? (
            others.map((member) => (
              <ListRow
                key={member.user_id}
                label={member.name}
                checked={picked.includes(member.user_id)}
                disabled={
                  opening || (!picked.includes(member.user_id) && picked.length >= maxOthers)
                }
                onOpen={() => toggle(member.user_id)}
              />
            ))
          ) : (
            <Text as="p" tone="muted" wrap className="px-2">
              No one else is in this Space yet.
            </Text>
          )}
        </div>
        {error ? (
          <SystemErrorNotice
            error={error}
            scope={`social:direct-message:${spaceId}`}
            title="Message could not be opened"
          />
        ) : null}
        <DialogFooter className="mt-5">
          <Button
            variant="secondary"
            size="lg"
            type="button"
            disabled={opening}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="lg" type="button" disabled={opening || !picked.length} onClick={() => void start()}>
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
