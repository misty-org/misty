import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/app/shell";
import {
  EngineReadyProbe,
  isEngineId,
  useMistyStore,
  usePersonalAgentsStore,
  useTutorChatIds,
  useTutorStore,
} from "@/features/agents";
import { startTour, useTours } from "@/features/onboarding";
import { Button } from "@/shared/ui";
import type { Space } from "../api/dto/entities";
import { OverviewCard, OverviewRow } from "./OverviewCard";

type Step = { id: string; title: string; done: boolean; open(): void };

/** The engines the person's agents run on: each is asked whether it's installed and signed in. */
function useAgentEngines() {
  const agents = usePersonalAgentsStore((state) => state.agents);
  return useMemo(
    () => [
      ...new Set(
        agents.flatMap((agent) =>
          agent.enabled && isEngineId(agent.engine) ? [agent.engine] : [],
        ),
      ),
    ],
    [agents],
  );
}

/**
 * First things to try, on a Space's home, for someone new: each ticks itself off from what has
 * really happened on this device or in this Space, never from a click on the list. It goes away
 * once everything is done, or when put away with Hide, which this device remembers.
 *
 * An AI counts once one of the person's engines is ready as setup decides it, signed in and not
 * merely installed. Asking counts only messages the person wrote in a chat of their own, not the
 * Lab's runs. Inviting is the owner's alone, so only the owner sees it, and it ticks once they
 * have sent an invitation (still waiting, or accepted). It comes before writing a doc, since
 * what someone makes while alone in a Space stays private after people join.
 */
export function GetStartedCard({ space, wroteDoc }: { space: Space; wroteDoc: boolean }) {
  const navigate = useNavigate();
  const engines = useAgentEngines();
  const [ready, setReady] = useState<ReadonlySet<string>>(new Set());
  const onReady = useCallback((engine: string, isReady: boolean) => {
    setReady((current) => {
      if (current.has(engine) === isReady) return current;
      const next = new Set(current);
      if (isReady) next.add(engine);
      else next.delete(engine);
      return next;
    });
  }, []);
  const hasAi = engines.some((engine) => ready.has(engine));
  const labChats = useTutorChatIds();
  const chatted = useMistyStore((state) =>
    state.conversations.some(
      (chat) =>
        !labChats.has(chat.id) &&
        chat.messages.some((message) => message.role === "user" && !message.source),
    ),
  );
  const notebook = useTutorStore((state) => Object.keys(state.notebooks).length > 0);
  const { loaded, seen, checklistHidden, hideChecklist } = useTours();
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const owner = space.role === "owner";
  // Only the owner invites, so anyone else here besides them came on one of their invitations.
  const invited = space.pending_count > 0 || space.member_count > 1;

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
    ...(owner
      ? [
          {
            id: "invite",
            title: "Invite a friend",
            done: invited,
            open: () => navigate(`${base}/settings/members?invite=1`),
          },
        ]
      : []),
    { id: "doc", title: "Write a doc", done: wroteDoc, open: () => navigate(`${base}/notes`) },
  ];
  const left = steps.filter((step) => !step.done).length;
  if (!loaded || checklistHidden || left === 0) return null;

  return (
    <span data-tour="space-get-started" className="contents">
      {/* Engines are asked only while the list shows; until one answers ready, the step is open. */}
      {engines.map((engine) => (
        <EngineReadyProbe key={engine} engine={engine} onReady={onReady} />
      ))}
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
              step.done ? <CircleCheck aria-label="Done" /> : <Circle aria-label="Not done yet" />
            }
            title={step.title}
            trailing={step.done ? null : <ChevronRight aria-hidden="true" />}
            onOpen={step.open}
          />
        ))}
      </OverviewCard>
    </span>
  );
}
