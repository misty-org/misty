import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  AvatarFallback,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  FieldError,
  ListRow,
  ListRowSkeleton,
} from "@misty/ui";
import { personTone } from "@/shared/lib/personTone";
import { personInitials } from "@/shared/lib/personInitials";
import { directApi, type DirectConversation, type Person } from "./api";
import { dmPath, reloadDms, reloadFriends, useFriends } from "./directData";

/** The most people a group DM holds, the person included. */
const mostPeople = 10;

function Face({ person }: { person: Person }) {
  return (
    <Avatar size="sm" tone={personTone(person.user_id)}>
      <AvatarFallback>{personInitials(person.username)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Adds friends to a DM. Adding to a one-to-one DM starts a new group with the two of them and
 * the people picked, which opens; a group takes them in.
 */
export function AddPeopleDialog({
  dm,
  open,
  onOpenChange,
}: {
  dm: DirectConversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const friends = useFriends();
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) {
      setPicked([]);
      setError("");
    }
  }, [open]);

  const inDm = new Set(dm.members.map((member) => member.user_id));
  const candidates = (friends.data?.friends ?? []).filter((person) => !inDm.has(person.user_id));
  const room = mostPeople - dm.members.length;
  const toggle = (userId: string, on: boolean) =>
    setPicked((current) =>
      on
        ? current.includes(userId) || current.length >= room
          ? current
          : [...current, userId]
        : current.filter((id) => id !== userId),
    );

  const add = async () => {
    if (!picked.length || adding) return;
    setAdding(true);
    setError("");
    try {
      const result = await directApi.addDmMembers(dm.id, picked);
      await reloadDms().catch(() => undefined);
      onOpenChange(false);
      if (result.id !== dm.id) navigate(dmPath(result.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "They couldn't be added.");
    } finally {
      setAdding(false);
    }
  };

  const list = () => {
    if (!friends.data && friends.loading)
      return <ListRowSkeleton label="Loading friends" rows={4} leading trailing="text" />;
    if (!friends.data)
      return (
        <ErrorState
          inline
          title="Your friends couldn't be loaded"
          action={{ label: "Try again", onClick: () => void reloadFriends().catch(() => undefined) }}
        />
      );
    if (!candidates.length)
      return (
        <EmptyState
          inline
          title="No one to add"
          line="Friends who aren't here yet show here."
        />
      );
    return candidates.map((person) => {
      const checked = picked.includes(person.user_id);
      const full = !checked && picked.length >= room;
      return (
        <ListRow
          key={person.user_id}
          label={person.username}
          leading={<Face person={person} />}
          disabled={full}
          onOpen={() => toggle(person.user_id, !checked)}
          trailing={
            <Checkbox
              checked={checked}
              disabled={full}
              aria-label={`Add ${person.username}`}
              onCheckedChange={(next) => toggle(person.user_id, next === true)}
            />
          }
        />
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !adding && onOpenChange(next)}>
      <DialogContent size="sm" layout="scroll">
        <DialogHeader>
          <DialogTitle>Add people</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col">{list()}</div>
          <FieldError message={error || undefined} />
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" size="lg" disabled={adding} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!picked.length || adding}
            onClick={() => void add()}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
