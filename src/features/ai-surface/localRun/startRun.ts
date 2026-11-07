import { agentAccountId } from "@/features/agents/agentAccount";
import { rememberRun } from "@/features/agents/localRun";
import { noteOnboardingStep } from "@/features/ai-surface/localAiSettings";
import { spaceWindow } from "@/features/workspace/spaceWindow";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { withDeviceRunGrants } from "../deviceRunGrants";
import type { AiInvocationCreated, AiInvocationRequest } from "../types";
import { rememberArtifactRequest } from "./artifacts";
import { buildRunBody } from "./runBody";
import { conversationIdFor, followAddress, runIdFor } from "./runIdentity";

/**
 * Starts a run in the crate on this computer, with no server in the path
 * Its tools learn what it may reach from its saved entry, so that's
 * written first: the run can call one the moment it starts.
 */
export async function startLocalRun(input: AiInvocationRequest): Promise<AiInvocationCreated> {
  if (!hasTauriInternals()) throw new Error("Agents run in the Misty app.");
  const account = agentAccountId();
  const runId = await runIdFor(account, input.idempotencyKey);
  // A sub-agent is in no chat: it has nobody to ask, and reports to its parent.
  const conversationId = input.delegatedFrom
    ? ""
    : (input.conversationId ?? (await conversationIdFor(account, input.idempotencyKey)));
  const deviceContexts = await withDeviceRunGrants(
    input.deviceContexts,
    input.agentId,
    conversationId || runId,
  );
  const request: AiInvocationRequest = {
    ...input,
    deviceContexts,
    conversationId,
    spaceId: input.spaceId ?? spaceWindow().spaceId ?? undefined,
  };
  const { body, sources, requestedKind, permissionMode, collaborationMode } = await buildRunBody(
    request,
    runId,
    conversationId,
  );
  const remembered = { ...request, permissionMode, collaborationMode };
  await rememberRun(runId, conversationId, remembered, deviceContexts, {
    account,
    voice: Boolean(input.idempotencyKey.startsWith("voice-")),
    parentRunId: input.parentRunId,
    notebookKey: input.notebookKey,
  });
  if (requestedKind || (input.selection && input.surfaceId.startsWith("notes")))
    await rememberArtifactRequest({
      runId,
      account,
      requestedKind,
      surfaceId: input.surfaceId,
      selection: input.selection,
      context: input.context,
      sources: sources.map((source) => source.citation),
    }).catch(() => undefined);
  await invoke("agent_run_start", { runId, body });
  void noteOnboardingStep(input);
  return {
    invocationId: runId,
    conversationId,
    state: "running",
    eventsUrl: followAddress(runId),
  };
}
