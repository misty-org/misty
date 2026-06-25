import { Button } from "@/shared/ui";
import { Bot, Plus } from "lucide-react";

export function AgentEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      aria-label="Get started with agents"
      className="grid min-h-0 place-items-center px-6 py-10"
    >
      <div className="grid max-w-sm justify-items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-2xl border border-charcoal-border bg-charcoal-card text-cream">
          <Bot size={22} />
        </span>
        <div>
          <h1 className="m-0 text-lg font-medium text-cream-bright">Create your first Agent</h1>
          <p className="mb-0 mt-1.5 text-sm leading-relaxed text-cream-muted">
            Give it a name and tell it how to help. Then start a conversation.
          </p>
        </div>
        <Button type="button" onClick={onCreate}>
          <Plus size={15} />
          Create Agent
        </Button>
      </div>
    </section>
  );
}
