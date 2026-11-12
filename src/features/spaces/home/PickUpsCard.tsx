import { BookmarkCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AgentAvatar,
  draftRequestForAgent,
  PickUpDialog,
  pickUpRequest,
  pickUpTopic,
  shortAgo,
  usePersonalAgentsStore,
  type GlobalAiConversation,
} from "@/features/agents";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  ErrorNotification,
  MenuTrigger,
} from "@/shared/ui";
import { notesApi } from "../journal/notes/api/api";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";
import { agentOf, chatTitle } from "./overviewData";

interface PickUpNote {
  id: string;
  topic: string;
  updatedAt: string;
}

/** How many pick-ups and chats the card offers. */
const shown = 5;

/**
 * Where agents left off. "Save where it left off" asks a chat's agent to draft a note, which the
 * person edits and sends; picking one up starts a new chat with any of the person's agents, on
 * any engine, with the note in its composer, unsent.
 */
export function PickUpsCard({
  spaceId,
  chats,
}: {
  spaceId: string;
  chats: GlobalAiConversation[];
}) {
  const agents = usePersonalAgentsStore((state) => state.agents);
  const mine = agents.filter((agent) => agent.enabled);
  const [notes, setNotes] = useState<PickUpNote[] | null>(null);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState<GlobalAiConversation>();
  const [picking, setPicking] = useState<PickUpNote>();
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    notesApi
      .list(spaceId)
      .then(({ notes }) => {
        if (!live) return;
        setNotes(
          notes
            .flatMap((note) => {
              const topic = pickUpTopic(note.title);
              return topic
                ? [{ id: note.id, topic, updatedAt: note.updated_at ?? note.created_at ?? "" }]
                : [];
            })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, shown),
        );
      })
      .catch(() => live && setNotes((known) => known ?? []));
    return () => {
      live = false;
    };
  }, [spaceId, version]);

  // Chats an agent can sum up: they have a finished answer to start from.
  const finished = useMemo(
    () =>
      chats
        .filter((chat) => chat.agentId && chat.messages.some((m) => m.role === "assistant"))
        .slice(0, shown),
    [chats],
  );

  const pickUp = async (note: PickUpNote, agentId: string) => {
    setPicking(undefined);
    setError("");
    const full = await notesApi.get(spaceId, note.id).catch(() => undefined);
    if (!full?.markdown) return setError("That note couldn't be read. Try again.");
    const problem = draftRequestForAgent(agentId, pickUpRequest(note.topic, full.markdown));
    if (problem) setError(problem);
  };

  const save = finished.length ? (
    <DropdownMenu>
      <MenuTrigger variant="ghost" label="Save where it left off" />
      <DropdownMenuContent align="end">
        {finished.map((chat) => (
          <DropdownMenuItem key={chat.id} onSelect={() => setSaving(chat)}>
            <span className="truncate">{chatTitle(chat.title)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  return (
    <OverviewCard title="Pick up" action={save}>
      {notes === null ? (
        <OverviewRowsSkeleton rows={2} />
      ) : notes.length ? (
        notes.map((note) => (
          <OverviewRow
            key={note.id}
            kind="schedule"
            leading={<BookmarkCheck className="size-4" aria-hidden="true" />}
            title={note.topic}
            trailing={shortAgo(note.updatedAt)}
            onOpen={() => (mine.length === 1 ? void pickUp(note, mine[0]!.id) : setPicking(note))}
          />
        ))
      ) : (
        <OverviewEmpty>Nothing to pick up</OverviewEmpty>
      )}
      <ErrorNotification message={error} onDismiss={() => setError("")} />
      {saving && (
        <PickUpDialog
          open
          onOpenChange={(open) => !open && setSaving(undefined)}
          spaceId={spaceId}
          conversationId={saving.id}
          chatTitle={chatTitle(saving.title)}
          agent={agentOf(agents, saving.agentId)}
          onSent={() => setVersion((value) => value + 1)}
        />
      )}
      <Dialog open={Boolean(picking)} onOpenChange={(open) => !open && setPicking(undefined)}>
        <DialogContent className="max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="text-sm">Pick up with</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1">
            {mine.map((agent) => (
              <OverviewRow
                key={agent.id}
                leading={<AgentAvatar agent={agent} compact />}
                title={agent.name}
                onOpen={() => picking && void pickUp(picking, agent.id)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </OverviewCard>
  );
}
