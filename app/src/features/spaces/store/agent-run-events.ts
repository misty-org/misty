import type { SpacesStore } from "../model/stores/spaces/interfaces/useSpacesStore";
import type { SpaceEvent, SpaceMessage } from "@/services/spaces/dto/interfaces/types";

export function applyAgentRunEvent(
  event: SpaceEvent,
  set: (partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>)) => void,
) {
  const sourceMessageId = String(event.payload.source_message_id ?? "");
  if (!sourceMessageId) return;
  set((state) => ({
    messagesBySpace: {
      ...state.messagesBySpace,
      [event.space_id]: updateMessageAgentRun(
        state.messagesBySpace[event.space_id] ?? [],
        sourceMessageId,
        event,
      ),
    },
  }));
}

function updateMessageAgentRun(messages: SpaceMessage[], messageId: string, event: SpaceEvent) {
  const triggerId = String(event.payload.trigger_id ?? event.entity_id ?? "");
  if (!triggerId) return messages;
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const next = {
      id: triggerId,
      agent_id: String(event.payload.agent_id ?? ""),
      state: event.type.slice("agent.run.".length) as NonNullable<
        SpaceMessage["triggered_runs"]
      >[number]["state"],
      run_id: String(event.payload.run_id ?? "") || undefined,
      error_code: String(event.payload.error_code ?? "") || undefined,
      error_message: String(event.payload.error_message ?? "") || undefined,
    };
    const runs = [...(message.triggered_runs ?? [])];
    const index = runs.findIndex((run) => run.id === triggerId);
    if (index >= 0) runs[index] = { ...runs[index], ...next };
    else runs.push(next);
    return { ...message, triggered_runs: runs };
  });
}
