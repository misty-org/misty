import { Plus } from "lucide-react";
import type { AgentProfile } from "@/shared/schemas";
import { MistyComposer } from "@/features/global-search/MistyComposer";
import { Button } from "@/shared/ui";
import { AgentAvatar } from "../components/AgentAvatar";

/** Choosing who a new chat goes to; the composer waits until an agent is picked. */
export function AgentNewChat({
  agents,
  search,
  onCreate,
  onSelect,
}: {
  agents: AgentProfile[];
  search: string;
  onCreate(): void;
  onSelect(agentId: string): void;
}) {
  const query = search.trim().toLocaleLowerCase();
  return (
    <section className="agent-new-chat">
      <div className="agent-recipient-results" role="group" aria-label="Choose an agent">
        <Button variant="ghost" justify="start" className="agent-recipient-row" onClick={onCreate}>
          <Plus size={16} />
          Create new agent
        </Button>
        {agents
          .filter((a) => a.name.toLocaleLowerCase().includes(query))
          .map((a) => (
            <Button
              variant="ghost"
              justify="start"
              key={a.id}
              className="agent-recipient-row"
              onClick={() => onSelect(a.id)}
            >
              <AgentAvatar agent={a} />
              <span className="truncate">{a.name}</span>
            </Button>
          ))}
      </div>
      <div className="agent-compose-area">
        <MistyComposer
          layout="conversation"
          value=""
          onChange={() => {}}
          mode="ask"
          attachments={[]}
          maxAttachments={4}
          onAddFiles={() => {}}
          onRemoveAttachment={() => {}}
          onSubmit={() => {}}
          placeholder="Message…"
          disabled
        />
      </div>
    </section>
  );
}
