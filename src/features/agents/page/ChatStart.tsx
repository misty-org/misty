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
import { EmptyState, StarterPrompts, Text, type StarterPrompt } from "@/shared/ui";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useSavedModelKeys } from "../models/modelKeys";
import { useNow } from "@/shared/hooks/useNow";

/**
 * Everyday things to ask, for someone who has never talked to an AI. Each leaves a blank at its
 * end for the person to fill in, and nothing is sent until they send it.
 */
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

/** "Good morning" and so on, by the person's own clock. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * When the chat's agent is Misty's own and there is no model key to run it, there is no AI to talk
 * to yet. Only a keychain that answered "no keys" counts.
 */
function useNeedsSetup(agent: AgentProfile): boolean {
  const { saved, unreadable } = useSavedModelKeys();
  return !agent.engine && !unreadable && saved !== null && saved.length === 0;
}

/**
 * What an empty chat shows above its composer: a greeting and the question. When there is no AI to
 * talk to yet it sends the person to setup instead of letting the first message fail.
 */
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
    <div className="mx-auto mb-5 px-5 text-center">
      {/* The display size, not a poster size, so the greeting reads as a hello, not a slide title. */}
      <Text
        as="h1"
        wrap
        size="display"
        tone="bright"
        weight="regular"
        className="m-0 leading-[1.3] tracking-[-0.01em]"
      >
        {greetingFor(new Date(now))}. What's on your mind?
      </Text>
    </div>
  );
}

/** Ideas to start from, as chips under an empty chat's composer. Hidden until there's an AI. */
export function ChatStartIdeas({ agent }: { agent: AgentProfile }) {
  if (useNeedsSetup(agent)) return null;
  return (
    <StarterPrompts
      variant="chips"
      label="Ideas to start with"
      prompts={ideas}
      onPick={(picked) => useMistyStore.getState().setQuery(picked.prompt)}
      className="mt-3"
    />
  );
}
