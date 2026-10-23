import type { Dispatch, SetStateAction } from "react";
import { personalAgentsApi, type AgentMemory } from "@/api/agents/native";
import { Button, Textarea } from "@/shared/ui";

/** The preferences an agent remembered, each editable or forgettable. */
export function AgentMemoryList({
  agentId,
  spaceId,
  memories,
  setMemories,
  editing,
  setEditing,
  draft,
  setDraft,
  onError,
  onTalk,
}: {
  agentId: string;
  spaceId: string;
  memories: AgentMemory[];
  setMemories: Dispatch<SetStateAction<AgentMemory[]>>;
  editing?: string;
  setEditing(id: string | undefined): void;
  draft: string;
  setDraft(value: string): void;
  onError(message: string): void;
  onTalk(): void;
}) {
  if (!memories.length) return null;
  return (
    <section className="border-t border-charcoal-border pt-5">
      <h3 className="mb-2 text-sm font-medium">Remembered preferences</h3>
      {memories.map((memory) => (
        <div key={memory.id} className="flex items-start gap-3 py-2 text-sm">
          <div className="flex-1">
            {editing === memory.id ? (
              <label className="block">
                <span className="sr-only">Preference</span>
                <Textarea
                  maxLength={1000}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    type="button"
                    size="sm"
                    disabled={!draft.trim()}
                    onClick={() => {
                      void personalAgentsApi
                        .updateMemory(agentId, memory.id, spaceId, draft)
                        .then(() => {
                          setMemories((items) =>
                            items.map((item) =>
                              item.id === memory.id
                                ? {
                                    ...item,
                                    content: draft,
                                  }
                                : item,
                            ),
                          );
                          setEditing(undefined);
                        })
                        .catch((reason) => onError(String(reason)));
                    }}
                  >
                    Save preference
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    size="sm"
                    onClick={() => setEditing(undefined)}
                  >
                    Cancel
                  </Button>
                </div>
              </label>
            ) : (
              memory.content
            )}
            <span className="mt-1 block text-xs text-cream-muted">
              {memory.space_id ? "Saved conversation scope" : "Personal"}
            </span>
          </div>
          <Button
            variant="outline"
            type="button"
            size="sm"
            onClick={() => {
              setEditing(memory.id);
              setDraft(memory.content);
            }}
          >
            Edit
          </Button>
          <Button
            variant="outline"
            type="button"
            size="sm"
            onClick={() => {
              void personalAgentsApi
                .forget(agentId, memory.id)
                .then(() => setMemories((items) => items.filter((item) => item.id !== memory.id)))
                .catch((reason) => onError(String(reason)));
            }}
          >
            Forget
          </Button>
        </div>
      ))}
      <Button variant="ghost" type="button" className="text-sm underline" onClick={onTalk}>
        Ask this agent to change a preference
      </Button>
    </section>
  );
}
