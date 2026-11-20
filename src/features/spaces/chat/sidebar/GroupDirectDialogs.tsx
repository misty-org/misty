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
import type { MentionableAgent } from "../useSpaceMessageSpansStore";

/** The most people a group DM holds, the one who made it included. */
const maxMembers = 10;

/** Adds people from the Space to a group DM. They see all of its history. */
export function AddPeopleDialog({
  spaceId,
  conversation,
  members,
  open,
  onOpenChange,
  onChanged,
}: {
  spaceId: string;
  conversation: SpaceConversation;
  members: SpaceMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (conversation: SpaceConversation) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inside = new Set(conversation.participants.flatMap((person) => person.user_id ?? []));
  const people = conversation.participants.filter((person) => person.kind === "person").length;
  const room = maxMembers - people;
  const candidates = members.filter((member) => !inside.has(member.user_id));
  const toggle = (userId: string) =>
    setPicked((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  const add = async () => {
    if (saving || !picked.length) return;
    setSaving(true);
    setError("");
    try {
      onChanged(await spacesApi.addConversationMembers(spaceId, conversation.id, picked));
      setPicked([]);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "They couldn't be added.");
    } finally {
      setSaving(false);
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
          <DialogTitle>Add people</DialogTitle>
        </DialogHeader>
        <div className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto">
          {candidates.length ? (
            candidates.map((member) => (
              <ListRow
                key={member.user_id}
                label={member.name}
                checked={picked.includes(member.user_id)}
                disabled={saving || (!picked.includes(member.user_id) && picked.length >= room)}
                onOpen={() => toggle(member.user_id)}
              />
            ))
          ) : (
            <Text as="p" tone="muted" wrap className="px-2">
              Everyone in this Space is already here.
            </Text>
          )}
        </div>
        {error ? (
          <SystemErrorNotice error={error} scope={`social:group:${spaceId}`} title="Couldn't add" />
        ) : null}
        <DialogFooter className="mt-5">
          <Button variant="secondary" size="lg" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="lg" type="button" disabled={saving || !picked.length} onClick={() => void add()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lists the person's own agents in a DM, or takes them out. An agent there answers only when its owner
 * mentions it; what it writes in the chat is a message everyone in it can read.
 */
export function ConversationAgentsDialog({
  spaceId,
  conversation,
  currentUserId,
  agents,
  open,
  onOpenChange,
  onChanged,
}: {
  spaceId: string;
  conversation: SpaceConversation;
  currentUserId: string | undefined;
  agents: readonly MentionableAgent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listed = new Set(
    conversation.participants.flatMap((person) =>
      person.kind === "agent" && person.owner_user_id === currentUserId && person.agent_id
        ? [person.agent_id]
        : [],
    ),
  );
  const toggle = async (agent: MentionableAgent) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (listed.has(agent.agent_id))
        await spacesApi.removeConversationAgent(spaceId, conversation.id, agent.agent_id);
      else
        await spacesApi.addConversationAgent(
          spaceId,
          conversation.id,
          agent.agent_id,
          agent.agent_name,
        );
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The agent couldn't be changed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agents in this chat</DialogTitle>
        </DialogHeader>
        <div className="misty-transient-scrollbar mt-4 grid max-h-56 gap-1 overflow-y-auto">
          {agents.length ? (
            agents.map((agent) => (
              <ListRow
                key={agent.agent_id}
                label={agent.agent_name}
                checked={listed.has(agent.agent_id)}
                disabled={busy}
                onOpen={() => void toggle(agent)}
              />
            ))
          ) : (
            <Text as="p" tone="muted" wrap className="px-2">
              You have no agents to add.
            </Text>
          )}
        </div>
        {error ? (
          <SystemErrorNotice
            error={error}
            scope={`social:group-agents:${spaceId}`}
            title="Couldn't change agents"
          />
        ) : null}
        <DialogFooter className="mt-5">
          <Button size="lg" type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
