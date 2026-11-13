import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import { useMistyStore, usePersonalAgentsStore, useTutorStore } from "@/features/agents";
import { startTour, useTours } from "@/features/onboarding";
import { Button } from "@/shared/ui";
import type { Space } from "../api/dto/entities";
import { OverviewCard, OverviewRow } from "./OverviewCard";

type Step = { id: string; title: string; done: boolean; open(): void };

/**
 * First things to try, on a Space's home, for someone new: each ticks itself off from what has
 * really happened on this device or in this Space, never from a click on the list. It goes away
 * once everything is done, or when put away with Hide, which this device remembers.
 */
export function GetStartedCard({ space, wroteDoc }: { space: Space; wroteDoc: boolean }) {
  const navigate = useNavigate();
  const hasAi = usePersonalAgentsStore((state) =>
    state.agents.some((agent) => agent.engine && agent.enabled),
  );
  const chatted = useMistyStore((state) =>
    state.conversations.some((chat) => chat.messages.length > 0),
  );
  const notebook = useTutorStore((state) => Object.keys(state.notebooks).length > 0);
  const { loaded, seen, checklistHidden, hideChecklist } = useTours();
  const base = `/spaces/${encodeURIComponent(space.id)}`;

  const steps: Step[] = [
    { id: "ai", title: "Set up an AI", done: hasAi, open: () => navigate(routes.setup) },
    { id: "chat", title: "Ask your AI something", done: chatted, open: () => navigate("/agents") },
    {
      id: "tour",
      title: "Take the tour",
      done: seen.includes("welcome"),
      open: () => startTour("welcome"),
    },
    {
      id: "notebook",
      title: "Learn something in the lab",
      done: notebook,
      open: () => navigate("/agents?view=lab"),
    },
    { id: "doc", title: "Write a doc", done: wroteDoc, open: () => navigate(`${base}/notes`) },
    {
      id: "invite",
      title: "Invite a friend",
      done: space.member_count > 1,
      open: () => navigate(`${base}/settings/members?invite=1`),
    },
  ];
  const left = steps.filter((step) => !step.done).length;
  if (!loaded || checklistHidden || left === 0) return null;

  return (
    <span data-tour="space-get-started" className="contents">
      <OverviewCard
        title="Get started"
        count={left}
        action={
          <Button type="button" variant="quiet" onClick={hideChecklist}>
            Hide
          </Button>
        }
      >
        {steps.map((step) => (
          <OverviewRow
            key={step.id}
            leading={
              step.done ? (
                <CircleCheck className="size-4" aria-label="Done" />
              ) : (
                <Circle className="size-4" aria-label="Not done yet" />
              )
            }
            title={step.title}
            trailing={step.done ? null : <ChevronRight className="size-4" aria-hidden="true" />}
            onOpen={step.open}
          />
        ))}
      </OverviewCard>
    </span>
  );
}
