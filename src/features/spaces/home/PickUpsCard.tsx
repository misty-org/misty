import { BookmarkCheck } from "lucide-react";
import { useMemo, useState } from "react";
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
  MenuItem,
  MenuTrigger,
  useNotice,
} from "@/shared/ui";
import { notesApi } from "../journal/notes/api/api";
import { useSpaceNoteList } from "../journal/notes/api/notesResource";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";
import { agentOf, chatTitle } from "./overviewData";
import { useNow } from "@/shared/hooks/useNow";

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
  solo,
  chats,
}: {
  spaceId: string;
  /** Only the person is in this Space, so a saved pick-up is theirs alone. */
  solo: boolean;
  chats: GlobalAiConversation[];
}) {
  const now = useNow();
  const agents = usePersonalAgentsStore((state) => state.agents);
  const mine = agents.filter((agent) => agent.enabled);
  // From the Space's shared, cached list of docs, so the card paints at once on a revisit.
  const noteList = useSpaceNoteList(spaceId);
  const { reload: reloadNotes } = noteList;
  const notes = useMemo<PickUpNote[] | null>(() => {
    if (!noteList.data) return noteList.error ? [] : null;
    return noteList.data
      .flatMap((note) => {
        const topic = pickUpTopic(note.title);
        return topic
          ? [{ id: note.id, topic, updatedAt: note.updated_at ?? note.created_at ?? "" }]
          : [];
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, shown);
  }, [noteList.data, noteList.error]);
  const [saving, setSaving] = useState<GlobalAiConversation>();
  const [picking, setPicking] = useState<PickUpNote>();
  const [error, setError] = useState("");

  // Chats an agent can sum up: they have a finished answer to start from.
  const finished = useMemo(
    () =>
      chats
        .filter((chat) => chat.agentId && chat.messages.some((m) => m.role === "assistant"))
        .slice(0, shown),
    [chats],
  );

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  const pickUp = async (note: PickUpNote, agentId: string) => {
    setPicking(undefined);
    setError("");
    const full = await notesApi.get(spaceId, note.id).catch(() => undefined);
    if (!full?.markdown) return setError("That doc couldn't be read. Try again.");
    const problem = draftRequestForAgent(agentId, pickUpRequest(note.topic, full.markdown));
    if (problem) setError(problem);
  };

  const save = finished.length ? (
    <DropdownMenu>
      <MenuTrigger label="Save where it left off" />
      <DropdownMenuContent align="end">
        {finished.map((chat) => (
          <MenuItem key={chat.id} label={chatTitle(chat.title)} onSelect={() => setSaving(chat)} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  return (
    <OverviewCard title="Pick up" action={save}>
      {notes === null ? (
        <OverviewRowsSkeleton rows={2} kind="schedule" detail={false} />
      ) : notes.length ? (
        notes.map((note) => (
          <OverviewRow
            key={note.id}
            kind="schedule"
            leading={<BookmarkCheck aria-hidden="true" />}
            title={note.topic}
            trailing={shortAgo(note.updatedAt, now)}
            onOpen={() => (mine.length === 1 ? void pickUp(note, mine[0]!.id) : setPicking(note))}
          />
        ))
      ) : (
        <OverviewEmpty>Nothing to pick up</OverviewEmpty>
      )}
      {saving && (
        <PickUpDialog
          open
          onOpenChange={(open) => !open && setSaving(undefined)}
          spaceId={spaceId}
          solo={solo}
          conversationId={saving.id}
          chatTitle={chatTitle(saving.title)}
          agent={agentOf(agents, saving.agentId)}
          onSent={() => void reloadNotes()}
        />
      )}
      <Dialog open={Boolean(picking)} onOpenChange={(open) => !open && setPicking(undefined)}>
        <DialogContent className="max-w-95">
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
