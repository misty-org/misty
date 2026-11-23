import {
  selectedPersonalAgent,
  usePersonalAgentsStore,
} from "../../personal/personal_agents_store";
import type { AiInvocationDeviceContext, AiSelectionSnapshot } from "../../runs/invocations";
import type { AiCaptureAttachment } from "../../runs/invocations/invocation_types";
import { assertMistyAvailable } from "../state/availability";
import { requestHostContext } from "../context/context_bridge";
import { globalMistyError } from "../state/global_misty_actions";
import type { MistyHandoff } from "./handoff";
import type { MistyState } from "../state/misty_state";
import type { MistyGet, MistySet } from "../state/misty_store_updates";
import { submissionEpoch } from "./misty_submission_epoch";
import type { GlobalAiContextRef } from "../state/conversation_types";

type SubmitArgs = Parameters<MistyState["submitAnswer"]>;

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
    const external = (await (await import("../context/screen_context")).screenStatus()).external;
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
      (await (await import("../context/screen_context")).screenStatus()).external
    ) {
      const screen = await (await import("../context/screen_context")).captureMistyScreen();
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
