import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
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
  SearchField,
} from "@misty/ui";
import { directApi, type DirectConversation, type Person } from "./api";
import { dmPath, reloadDms, reloadFriends, useFriends } from "./direct_data";
import { Face } from "./FriendsActivity";
import { statusWords, useCustomStatus, usePresence, useStatusStore } from "./status_store";

const mostPeople = 10;

function PickRow({
  person,
  checked,
  full,
  onToggle,
}: {
  person: Person;
  checked: boolean;
  full: boolean;
  onToggle: (on: boolean) => void;
}) {
  const presence = usePresence(person.user_id);
  const custom = useCustomStatus(person.user_id);
  const line = presence === "offline" ? statusWords.offline : custom || statusWords[presence];
  return (
    <ListRow
      label={person.username}
      description={line}
      leading={<Face userId={person.user_id} name={person.username} person={person} size="sm" />}
      disabled={full}
      onOpen={() => onToggle(!checked)}
      trailing={
        <Checkbox
          checked={checked}
          disabled={full}
          aria-label={`Add ${person.username}`}
          onCheckedChange={(next) => onToggle(next === true)}
        />
      }
    />
  );
}

export function AddPeopleDialog({
  dm,
  startWith,
  open,
  onOpenChange,
}: {
  dm?: DirectConversation;
  startWith?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const friends = useFriends();
  const statuses = useStatusStore((state) => state.byUser);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) setPicked(startWith ? [startWith] : []);
    else {
      setPicked([]);
      setQuery("");
      setError("");
    }
  }, [open, startWith]);

  const inDm = new Set((dm?.members ?? []).map((member) => member.user_id));
  const online = (person: Person) => (statuses[person.user_id]?.status ?? "offline") !== "offline";
  const candidates = (friends.data?.friends ?? [])
    .filter((person) => !inDm.has(person.user_id))
    .sort((a, b) => Number(online(b)) - Number(online(a)) || a.username.localeCompare(b.username));
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((person) => person.username.toLowerCase().includes(needle))
    : candidates;
  const room = mostPeople - (dm ? dm.members.length : 1);
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
      const result = dm
        ? await directApi.addDmMembers(dm.id, picked)
        : await directApi.createGroupDm(picked);
      await reloadDms().catch(() => undefined);
      onOpenChange(false);
      if (result.id !== dm?.id) navigate(dmPath(result.id));
    } catch (reason) {
      const fallback = dm ? "They couldn't be added." : "The group couldn't be started.";
      setError(reason instanceof Error ? reason.message : fallback);
    } finally {
      setAdding(false);
    }
  };

  const list = () => {
    if (!friends.data && friends.loading)
      return <ListRowSkeleton label="Loading friends" rows={6} leading lines={2} trailing="icon" />;
    if (!friends.data)
      return (
        <ErrorState
          inline
          title="Your friends couldn't be loaded"
          action={{
            label: "Try again",
            onClick: () => void reloadFriends().catch(() => undefined),
          }}
        />
      );
    if (!candidates.length)
      return dm ? (
        <EmptyState inline title="No one to add" line="Friends who aren't here yet show here." />
      ) : (
        <EmptyState inline title="No friends yet" line="Add friends to start a group with them." />
      );
    if (!shown.length)
      return (
        <EmptyState inline title="No friends match" line={`Nobody called “${query.trim()}”.`} />
      );
    return shown.map((person) => {
      const checked = picked.includes(person.user_id);
      return (
        <PickRow
          key={person.user_id}
          person={person}
          checked={checked}
          full={!checked && picked.length >= room}
          onToggle={(on) => toggle(person.user_id, on)}
        />
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !adding && onOpenChange(next)}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>{dm ? "Add people" : "New group"}</DialogTitle>
        </DialogHeader>
        {candidates.length ? (
          <div className="shrink-0">
            <SearchField
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search friends"
              aria-label="Search friends"
            />
          </div>
        ) : null}
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
            {dm ? "Add" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
