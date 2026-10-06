import { create } from "zustand";
import type { RemoteAgentDevice } from "../deviceGrants";

/** Other devices picked in the Agents composer for the next requests. Each
 * entry is that device's own signed policy, as last seen. */
export const useAgentDeviceTargets = create<{
  targets: RemoteAgentDevice[];
  setTargets: (targets: RemoteAgentDevice[]) => void;
}>((set) => ({
  targets: [],
  setTargets: (targets) => set({ targets }),
}));
