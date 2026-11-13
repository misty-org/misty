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
import type { AgentProfile } from "@/shared/schemas/native-agents";
import { EmptyState, StarterPrompts, type StarterPrompt } from "@/shared/ui";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useSavedModelKeys } from "../models/modelKeys";

/**
 * Everyday things to ask, for someone who has never talked to an AI. Each leaves a blank at its
 * end for the person to fill in, and nothing is sent until they send it.
 */
const ideas: readonly StarterPrompt[] = [
  idea("Plan a trip", Plane, "Plan a relaxed three-day trip to "),
  idea("Explain something", Lightbulb, "Explain how this works as if I'm completely new to it: "),
  idea("Write an email", Mail, "Help me write a friendly, short email to "),
  idea("Help me decide", Scale, "Help me compare these options and pick one: "),
  idea("Teach me a skill", GraduationCap, "Teach me, one small step at a time, the basics of "),
  idea("Summarize a long read", BookOpen, "Summarize this in a few plain sentences: "),
];

function idea(label: string, icon: LucideIcon, prompt: string): StarterPrompt {
  return { label, icon, prompt };
}

/**
 * What an empty chat shows above its composer: the question, then ideas to start from. When the
 * chat's agent is Misty's own and there is no model key to run it, there is no AI to talk to yet,
 * so it sends the person to setup instead of letting the first message fail.
 */
export function ChatStart({ agent }: { agent: AgentProfile }) {
  const navigate = useNavigate();
  const { saved, unreadable } = useSavedModelKeys();
  // Only a keychain that answered "no keys" means there is nothing to talk to.
  if (!agent.engine && !unreadable && saved !== null && saved.length === 0) {
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
    <div className="agent-studio-welcome">
      <h1>What can I do for you?</h1>
      <StarterPrompts
        label="Ideas to start with"
        prompts={ideas}
        onPick={(picked) => useMistyStore.getState().setQuery(picked.prompt)}
        className="mx-auto mt-6 max-w-2xl"
      />
    </div>
  );
}
