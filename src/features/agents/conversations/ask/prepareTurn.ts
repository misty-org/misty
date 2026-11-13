import { selectedPersonalAgent, usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "../../runs/invocations";
import type { AiCaptureAttachment } from "../../runs/invocations/invocationTypes";
import { assertMistyAvailable } from "../state/availability";
import { requestHostContext } from "../context/contextBridge";
import { globalMistyError } from "../state/globalMistyActions";
import type { MistyHandoff } from "./handoff";
import type { MistyState } from "../state/mistyState";
import type { MistyGet, MistySet } from "../state/mistyStoreUpdates";
import { submissionEpoch } from "./mistySubmissionEpoch";
import type { GlobalAiContextRef } from "../state/conversationTypes";

type SubmitArgs = Parameters<MistyState["submitAnswer"]>;

/**
 * What a turn sends besides its text: the agent, the page or selection it is about and, when the
 * person is on another app, a capture of their screen. Null when the turn was replaced or failed;
 * a failure is already shown.
 */
export async function prepareTurnContext(
  set: MistySet,
  get: MistyGet,
  input: {
    accountId: string;
    epoch: number;
    spaceId: string;
    origin: SubmitArgs[4];
    handoff?: MistyHandoff;
    companion: SubmitArgs[5];
    requestAgentId?: string;
    selection?: AiSelectionSnapshot;
    deviceContexts: AiInvocationDeviceContext[];
    onContextReady: () => void;
  },
): Promise<{
  requestAgentId: string;
  requestContext: GlobalAiContextRef[];
  selection?: AiSelectionSnapshot;
  deviceContexts: AiInvocationDeviceContext[];
  sourcePaneId?: string;
  capture?: AiCaptureAttachment;
} | null> {
  const { accountId, epoch, spaceId, origin, handoff, companion } = input;
  let requestContext = structuredClone(origin?.context ?? handoff?.context ?? []);
  let sourcePaneId = handoff?.paneId;
  let { requestAgentId, selection, deviceContexts } = input;
  try {
    await assertMistyAvailable(accountId, spaceId);
    if (
      usePersonalAgentsStore.getState().accountId !== accountId ||
      !usePersonalAgentsStore.getState().agents.length
    )
      await usePersonalAgentsStore.getState().load(accountId);
    if (get().accountId !== accountId || epoch !== submissionEpoch()) return null;
    const agent = requestAgentId || selectedPersonalAgent(spaceId || "")?.id;
    if (!agent) throw new Error("Agents could not be loaded. Reopen Misty to retry.");
    requestAgentId = agent;
    set({
      selectedAgentId: agent,
    });
    const external = (await (await import("../context/screenContext")).screenStatus()).external;
    if (!origin && !handoff?.selection && !external) {
      const snapshot = await requestHostContext({
        accountId,
        spaceId,
        targets: [],
      });
      requestContext = [...snapshot.context];
      selection = snapshot.selection ?? selection;
      sourcePaneId = snapshot.paneId;
    } else if (!companion && external && !handoff?.selection) requestContext = [];
    selection = handoff?.selection ?? selection;
    deviceContexts = handoff?.deviceContexts ?? deviceContexts;
    if (get().accountId !== accountId || epoch !== submissionEpoch()) return null;
    set({
      selectedSpaceId: spaceId,
    });
  } catch (error) {
    if (get().accountId === accountId && epoch === submissionEpoch())
      set({
        working: false,
        error: globalMistyError(error),
      });
    return null;
  }
  let capture: AiCaptureAttachment | undefined = companion?.capture ?? handoff?.capture;
  input.onContextReady();
  try {
    if (
      !companion &&
      !handoff?.selection &&
      (await (await import("../context/screenContext")).screenStatus()).external
    ) {
      const screen = await (await import("../context/screenContext")).captureMistyScreen();
      capture = screen.capture;
      if (get().accountId !== accountId || epoch !== submissionEpoch()) return null;
      set({
        screenLabel: screen.label,
      });
    }
  } catch (error) {
    if (get().accountId === accountId && epoch === submissionEpoch())
      set({
        working: false,
        error: globalMistyError(error),
      });
    return null;
  }
  return { requestAgentId, requestContext, selection, deviceContexts, sourcePaneId, capture };
}
