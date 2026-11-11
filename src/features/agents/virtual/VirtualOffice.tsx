import { Hammer } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Button, Pressable, Skeleton } from "@/shared/ui";
import { currentSpaceKey } from "../engines/enginesApi";
import { AgentAvatar } from "../personal/AgentAvatar";
import { AgentCard } from "./AgentCard";
import { BuildPanel } from "./BuildPanel";
import type { Actor } from "./office/behaviour";
import { useOfficeLayout } from "./office/layoutStore";
import { useTeammateAgents } from "./teammates";
import { useOfficeAgents } from "./useOfficeAgents";
import "./virtualOffice.css";

const OfficeScene = lazy(() => import("./office/OfficeScene"));

/** The shape of the office while it loads: the room, the row of agents and the build button. */
function OfficeSkeleton() {
  return (
    <div className="virtual-office-loading" aria-hidden="true">
      <Skeleton className="virtual-office-loading-room" />
    </div>
  );
}

/**
 * The Space's agents as an office to look into: each has a desk and types at it while it works,
 * comes to the door and waves when it needs its person, and drifts around the lounge when it has
 * nothing to do. Teammates' agents drop by as visitors. Picking a figure shows what it is up to
 * and opens its chat; build mode rearranges the furniture, which is kept per Space on this computer.
 * It only shows what the runs report.
 */
export function VirtualOffice(props: {
  onOpenChat(agentId: string, conversationId: string): void;
}) {
  const { agents, loading } = useOfficeAgents();
  const teammates = useTeammateAgents((state) => state.agents);
  const { layout, change, reset } = useOfficeLayout(currentSpaceKey());
  const [selected, setSelected] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [pickedItem, setPickedItem] = useState<string | null>(null);

  const actors = useMemo<Actor[]>(
    () => [
      ...agents.map(({ agent, state, doing, doingCode }) => ({
        id: agent.id,
        name: agent.name,
        owner: "",
        guest: false,
        state,
        doing,
        doingCode,
      })),
      ...teammates.map((mate) => ({
        id: `guest:${mate.key}`,
        name: mate.name,
        owner: mate.owner,
        guest: true,
        state: mate.state,
        doing: mate.doing,
        doingCode: "",
      })),
    ],
    [agents, teammates],
  );
  const picked = building ? undefined : actors.find((actor) => actor.id === selected);
  const pickedAgent = agents.find((item) => item.agent.id === picked?.id);

  return (
    <div
      className="virtual-office"
      data-misty-window-drag-block="true"
      data-building={building || undefined}
    >
      <Suspense fallback={<OfficeSkeleton />}>
        {loading ? (
          <OfficeSkeleton />
        ) : (
          <OfficeScene
            actors={actors}
            layout={layout}
            selected={selected}
            onSelect={setSelected}
            building={building}
            pickedItem={pickedItem}
            onPickItem={setPickedItem}
            onLayout={change}
          />
        )}
      </Suspense>
      <div className="virtual-office-bar">
        {building ? null : (
          <div className="virtual-office-roster" role="group" aria-label="Agents">
            {loading
              ? Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-8 w-24 rounded-full" />
                ))
              : agents.map(({ agent, state }) => (
                  <Pressable
                    key={agent.id}
                    type="button"
                    className="virtual-office-chip"
                    data-state={state}
                    aria-pressed={selected === agent.id}
                    onClick={() => setSelected(selected === agent.id ? null : agent.id)}
                  >
                    <AgentAvatar agent={agent} compact />
                    <span className="truncate">{agent.name}</span>
                    <span className="virtual-office-chip-state" aria-hidden="true" />
                  </Pressable>
                ))}
          </div>
        )}
        <Button
          variant="overlay"
          size="sm"
          className="ml-auto"
          aria-pressed={building}
          onClick={() => {
            setBuilding(!building);
            setPickedItem(null);
          }}
        >
          <Hammer aria-hidden="true" />
          {building ? "Done" : "Build"}
        </Button>
      </div>
      {building ? (
        <BuildPanel
          layout={layout}
          agents={agents}
          picked={pickedItem}
          onPick={setPickedItem}
          onLayout={change}
          onReset={() => {
            reset();
            setPickedItem(null);
          }}
        />
      ) : null}
      {picked ? (
        <AgentCard
          actor={picked}
          item={pickedAgent}
          onOpenChat={props.onOpenChat}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
