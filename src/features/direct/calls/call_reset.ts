import { forgetPublishedCallKey } from "./call_keys";
import { useCallStore } from "./call_store";
import { useAgentCall } from "./agent_call_store";

export function endCallsForAccountReset() {
  useAgentCall.getState().end();
  useCallStore.getState().leave();
  useCallStore.setState({ active: null, incoming: null, speaking: [], mic: null, audio: null });
  forgetPublishedCallKey();
}
