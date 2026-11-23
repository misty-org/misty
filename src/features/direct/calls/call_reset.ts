import { forgetPublishedCallKey } from "./call_keys";
import { useCallStore } from "./call_store";

export function endCallsForAccountReset() {
  useCallStore.getState().leave();
  useCallStore.setState({ active: null, incoming: null, speaking: [], mic: null, audio: null });
  forgetPublishedCallKey();
}
