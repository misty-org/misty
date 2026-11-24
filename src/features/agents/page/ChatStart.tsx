import {
  BookOpen,
  GraduationCap,
  Lightbulb,
  Mail,
  Plane,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import type { AgentProfile } from "@/shared/schemas/native_agents";
import { EmptyState, StarterPrompts, type StarterPrompt } from "@misty/ui";
import { AgentWelcome } from "../conversations/view/AgentWelcome";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { useDefaultEngine } from "../engines/default_engine";
import { useNow } from "@/shared/hooks/use_now";

const ideas: readonly StarterPrompt[] = [
  idea("Plan a trip", Plane, "Plan a relaxed three-day trip to "),
  idea("Write an email", Mail, "Help me write a friendly, short email to "),
  idea("Explain something", Lightbulb, "Explain how this works as if I'm completely new to it: "),
  idea("Help me decide", Scale, "Help me compare these options and pick one: "),
  idea("Teach me a skill", GraduationCap, "Teach me, one small step at a time, the basics of "),
  idea("Summarize", BookOpen, "Summarize this in a few plain sentences: "),
];

function idea(label: string, icon: LucideIcon, prompt: string): StarterPrompt {
  return { label, icon, prompt };
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

function useNeedsSetup(agent: AgentProfile): boolean {
  const { engine, ready } = useDefaultEngine();
  return (!agent.engine || agent.engine === "misty") && ready && !engine;
}

export function ChatStart({ agent }: { agent: AgentProfile }) {
  const now = useNow();
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
      <AgentWelcome agent={agent} line={`${greetingFor(new Date(now))}. What's on your mind?`}>
        <StarterPrompts
          label="Ideas to start with"
          align="start"
          prompts={ideas}
          onPick={(picked) => useMistyStore.getState().setQuery(picked.prompt)}
        />
      </AgentWelcome>
    </div>
  );
}
