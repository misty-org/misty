// The person's own computer as a run's device: runs carry the workspace context a chat sent
// from it carries, so device tools (the agent's own browser session, its programs and shell) run on it
// as they would for a real request. The app signs it as the run starts.
import { windowCall, type Bridge } from "./bridge.ts";

export interface Identity {
  agentId: string;
  deviceId: string;
}

/** Who a pass runs as: the app's default agent, on this computer. Works signed in or signed out. */
export function identityOf(bridge: Bridge): Promise<Identity> {
  return windowCall<Identity>(
    bridge,
    `const { personalAgentsApi } = await module("features/agents/personalAgentsApi.ts");
     const { thisComputerDeviceId } = await module("features/agents/workflows/deviceScheduledRuns.ts");
     const { agents } = await personalAgentsApi.list();
     return { agentId: agents[0]?.id ?? "", deviceId: (await thisComputerDeviceId()) ?? "" };`,
  );
}

/** The workspace context for one run, as a chat sent from this computer carries it. */
export function deviceContexts(bridge: Bridge): Promise<unknown[]> {
  return windowCall<unknown[]>(
    bridge,
    `const { desktopDeviceGrants } = await module("features/agents/deviceGrants.ts");
     return desktopDeviceGrants();`,
  );
}
