import { agentAccountId } from "../../personal/agent_account";
import { rememberRun } from "@/features/agents/local_run";
import { spacesSnapshot } from "@/features/app-windows";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { withDeviceRunGrants } from "../invocations/device_run_grants";
import type { AiInvocationCreated, AiInvocationRequest } from "../invocations/invocation_types";
import { rememberArtifactRequest } from "./artifacts";
import { buildRunBody } from "./run_body";
import { conversationIdFor, followAddress, runIdFor } from "./run_identity";
import { runHomeSpace } from "./run_space";

export async function startLocalRun(input: AiInvocationRequest): Promise<AiInvocationCreated> {
  const { account, runId, conversationId, deviceContexts, request, built } = await prepare(input);
  const { body, sources, requestedKind, permissionMode, collaborationMode } = built;
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
  return {
    invocationId: runId,
    conversationId,
    state: "running",
    eventsUrl: followAddress(runId),
  };
}

export async function warmLocalRun(input: AiInvocationRequest): Promise<void> {
  const { runId, built } = await prepare(input);
  await invoke("agent_run_warm_up", { runId, body: built.body });
}

async function prepare(input: AiInvocationRequest) {
  if (!hasTauriInternals()) throw new Error("Agents run in the Misty app.");
  const account = agentAccountId();
  const asked =
    input.spaceId && spacesSnapshot().spaces.some((space) => space.id === input.spaceId)
      ? input.spaceId
      : "";
  const spaceId = asked || (await runHomeSpace(account, input.agentId));
  const runId = await runIdFor(account, input.idempotencyKey);
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
    spaceId,
  };
  const built = await buildRunBody(request, runId, conversationId);
  return { account, runId, conversationId, deviceContexts, request, built };
}
