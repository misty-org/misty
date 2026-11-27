import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import {
  AddReactionButton,
  Avatar,
  AvatarFallback,
  Button,
  ChannelMessage,
  ChannelMessageText,
  ChannelReactions,
  ErrorState,
  PaneLoading,
  ReactionChip,
  ToolList,
  ToolPath,
  ToolRow,
  TurnFold,
  notify,
} from "@misty/ui";
import { personTone } from "@/shared/lib/person_tone";
import { personInitials } from "@/shared/lib/person_initials";
import { MistyMarkdown } from "../runs/markdown/MistyMarkdown";
import { Fold } from "../progress/WorkGroup";
import { continueThread } from "./continuation";
import { memberFace } from "./member_face";
import { reactionPicker } from "@/shared/lib/reaction_picker";
import {
  AGENT_THREAD_EVENT,
  sharedThreadsApi,
  splitStep,
  type SharedEntry,
  type SharedThread,
} from "./shared_threads";

const whenOf = (iso: string) => {
  const at = new Date(iso);
  return {
    time: at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
    short: at.toLocaleTimeString([], { timeStyle: "short" }),
  };
};

function stepRows(body: string) {
  return body
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const { verb, target } = splitStep(line);
      return (
        <li key={`${index}:${line}`}>
          <ToolRow name={verb} target={target || undefined} state="done" />
        </li>
      );
    });
}

function FoldedSteps({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  const rows = stepRows(body);
  return (
    <div className="grid gap-1">
      <TurnFold
        summary={rows.length === 1 ? "1 step" : `${rows.length} steps`}
        open={open}
        onToggle={() => setOpen(!open)}
        controls={stepsId}
      />
      <Fold id={stepsId} open={open} onReveal={() => setOpen(true)}>
        <ToolList label="Steps">{rows}</ToolList>
      </Fold>
    </div>
  );
}

function outputRows(body: string) {
  return body
    .split("\n")
    .filter(Boolean)
    .map((path) => (
      <li key={path}>
        <ToolRow name="Made" target={<ToolPath path={path} />} state="done" />
      </li>
    ));
}

function OwnerFace({ spaceId, userId, name }: { spaceId: string; userId: string; name: string }) {
  const Face = memberFace.maybe();
  if (Face) return <Face spaceId={spaceId} userId={userId} name={name} />;
  return (
    <Avatar size="lg" tone={personTone(userId)}>
      <AvatarFallback>{personInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

export function SharedThreadView(props: {
  spaceId: string;
  thread: SharedThread;
  agentName: string;
  agentAvatar: ReactNode;
}) {
  const { spaceId, thread } = props;
  const [entries, setEntries] = useState<SharedEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    void sharedThreadsApi.entries(spaceId, thread.id).then(
      (next) => setEntries(next),
      () => setFailed(true),
    );
  }, [spaceId, thread.id]);

  useEffect(() => {
    setEntries(null);
    load();
    const heard = (event: Event) => {
      const detail = (
        event as CustomEvent<{ entity_id?: string; payload?: { thread_id?: string } }>
      ).detail;
      if (detail?.entity_id === thread.id || detail?.payload?.thread_id === thread.id) load();
    };
    window.addEventListener(AGENT_THREAD_EVENT, heard);
    return () => window.removeEventListener(AGENT_THREAD_EVENT, heard);
  }, [load, thread.id]);

  const react = (entry: SharedEntry, emoji: string, on: boolean) =>
    void sharedThreadsApi
      .react(spaceId, thread.id, entry.key, emoji, on)
      .catch(() =>
        notify({ message: "That reaction didn't go through. Try again.", tone: "error" }),
      );

  const Picker = reactionPicker();
  const reactions = (entry: SharedEntry) => (
    <ChannelReactions
      add={
        Picker ? (
          <Picker onSelect={(emoji) => react(entry, emoji, true)}>
            <AddReactionButton />
          </Picker>
        ) : undefined
      }
    >
      {entry.reactions.map((reaction) => (
        <ReactionChip
          key={reaction.emoji}
          emoji={reaction.emoji}
          count={reaction.count}
          mine={reaction.mine}
          onToggle={() => react(entry, reaction.emoji, !reaction.mine)}
        />
      ))}
    </ChannelReactions>
  );

  if (failed && !entries) {
    return (
      <ErrorState
        title="This thread couldn't load"
        line="Check your connection and try again."
        action={{ label: "Try again", icon: RotateCw, onClick: load }}
      />
    );
  }
  if (!entries) return <PaneLoading label="Loading this thread" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {entries.map((entry, index) => {
          const fromAgent = entry.kind !== "ask";
          const name = fromAgent ? props.agentName : thread.owner_name || "Someone";
          const previous = entries[index - 1];
          const grouped =
            Boolean(previous) && (previous!.kind !== "ask") === fromAgent && entry.kind !== "ask";
          const when = whenOf(entry.created_at);
          return (
            <ChannelMessage
              key={entry.key}
              name={name}
              avatar={
                fromAgent ? (
                  props.agentAvatar
                ) : (
                  <OwnerFace spaceId={spaceId} userId={thread.owner_user_id} name={name} />
                )
              }
              time={when.time}
              shortTime={when.short}
              dateTime={entry.created_at}
              grouped={grouped}
              after={entry.kind === "ask" || entry.kind === "reply" ? reactions(entry) : undefined}
            >
              {entry.kind === "ask" ? (
                <ChannelMessageText>{entry.body}</ChannelMessageText>
              ) : entry.kind === "reply" ? (
                <MistyMarkdown>{entry.body}</MistyMarkdown>
              ) : entry.kind === "step" ? (
                <FoldedSteps body={entry.body} />
              ) : (
                <ToolList label="What it made">{outputRows(entry.body)}</ToolList>
              )}
            </ChannelMessage>
          );
        })}
      </div>
      <div className="flex flex-none justify-center px-4 py-3">
        <Button variant="primary" onClick={() => continueThread(spaceId, thread)}>
          Continue in my thread
        </Button>
      </div>
    </div>
  );
}
