import { useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import type { AgentProfile } from "@/shared/schemas/native_agents";
import { EmptyState } from "@misty/ui";
import { AgentWelcome } from "../conversations/view/AgentWelcome";
import { useDefaultEngine } from "../engines/default_engine";

function useNeedsSetup(agent: AgentProfile): boolean {
  const { engine, ready } = useDefaultEngine();
  return (!agent.engine || agent.engine === "misty") && ready && !engine;
}

export function ChatStart({ agent }: { agent: AgentProfile }) {
  const navigate = useNavigate();
  if (useNeedsSetup(agent)) {
    return (
      <EmptyState
        inline
        title="Connect an AI to start"
        line="Pick a free one, or sign in with an account you already have."
        action={{ label: "Set up an AI", onClick: () => navigate(routes.setup) }}
      />
    );
  }
  return (
    <div className="flex min-h-full flex-col justify-end pt-4 pb-6">
      <AgentWelcome
        agent={agent}
        line={`This is the beginning of your direct message history with ${agent.name || "Misty"}.`}
      />
    </div>
  );
}
