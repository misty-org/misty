import { agentAccountId } from "../../personal/agentAccount";
import { rememberRun } from "@/features/agents/localRun";
import { spacesSnapshot } from "@/features/app-windows";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { withDeviceRunGrants } from "../invocations/deviceRunGrants";
import type { AiInvocationCreated, AiInvocationRequest } from "../invocations/invocationTypes";
import { rememberArtifactRequest } from "./artifacts";
import { buildRunBody } from "./runBody";
import { conversationIdFor, followAddress, runIdFor } from "./runIdentity";
import { runHomeSpace } from "./runSpace";

/**
 * Starts a run in the crate on this computer, with no server in the path
 * Its tools learn what it may reach from its saved entry, so that's
 * written first: the run can call one the moment it starts.
 */
export async function startLocalRun(input: AiInvocationRequest): Promise<AiInvocationCreated> {
  if (!hasTauriInternals()) throw new Error("Agents run in the Misty app.");
  const account = agentAccountId();
  // Work asked for in a Space (an @mention in its chat, a Lab notebook, a Tutor job there) works
  // in and saves into that Space, when the person is in it. Everything else (a private chat, the
  // Code page, the companion) works in the agent's home Space, whichever Space the window shows.
  const asked =
    input.spaceId && spacesSnapshot().spaces.some((space) => space.id === input.spaceId)
      ? input.spaceId
      : "";
  const spaceId = asked || (await runHomeSpace(account, input.agentId));
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
    spaceId,
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
  return {
    invocationId: runId,
    conversationId,
    state: "running",
    eventsUrl: followAddress(runId),
  };
}
