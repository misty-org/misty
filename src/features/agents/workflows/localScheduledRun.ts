import { readRunState } from "../runs/invocations/invocationSubscription";
import { localDocuments } from "../conversations/state/localChats";
import { newLocalConversation } from "../conversations/state/localConversation";
import type { GlobalAiMessage } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { adoptFolderChanges } from "../personal/useAgentsStore";
import { useConversationFolder } from "../shared-folders/useConversationFolder";
import {
  completeScheduleRun,
  bindScheduleRun,
  releaseSchedule,
  type LocalSchedule,
} from "./localSchedules";
import type { LocalMethod } from "./localMethods";
import { renderMethod } from "./methodDefinition";
import { useScheduleFolders } from "./useScheduleFolders";

/**
 * Starts a claimed occurrence through the ordinary turn path. No server holds the workflow
 * or its schedule, so the turn carries the rendered instructions.
 */

/** What a person sees when a run started after it was due, and how many later runs it stands in for. */
export function lateNotice(schedule: LocalSchedule, now: number): string {
  if (!schedule.due_at) return "";
  const due = Date.parse(schedule.due_at);
  if (now - due < 2 * 60_000) return "";
  const when = new Date(due).toLocaleString(undefined, {
    timeZone: schedule.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const missed = schedule.missed_count ?? 0;
  const covers =
    missed === 1
      ? " One later run passed while it waited; this run covers it."
      : missed > 1
        ? ` ${missed} later runs passed while it waited; this run covers them.`
        : "";
  return `This run was due ${when} and started now, when this computer was back.${covers}`;
}

/** The turn's text, or null when the saved inputs no longer fit the workflow. */
export function scheduledRunPrompt(
  schedule: LocalSchedule,
  method: LocalMethod,
  now: number,
): string | null {
  const instructions = renderMethod(method.definition, schedule.inputs);
  if (instructions === null) return null;
  const late = lateNotice(schedule, now);
  return [
    `The user's scheduled workflow “${method.definition.title}” started this request automatically; ` +
      `they are not watching it run. Do the work, then report concisely what you found or did. ` +
      `Ask for approval instead of taking any irreversible action.`,
    ...(late ? [late] : []),
    instructions,
  ].join("\n\n");
}

/** The schedule's own chat, so every run reads as one thread. Made when a run first needs it. */
async function scheduleConversation(
  account: string,
  schedule: LocalSchedule,
  method: LocalMethod,
): Promise<string> {
  const known = schedule.conversation_id;
  const held = () => useMistyStore.getState().conversations.some((chat) => chat.id === known);
  if (known && held()) return known;
  // Right after a relaunch this window may not have loaded its chats yet, and a run due then still
  // goes on in the workflow's one chat.
  if (known && (await localDocuments.get(account, "conversation", known).catch(() => null))) {
    await useMistyStore.getState().loadConversations();
    if (held()) return known;
  }
  const conversation = newLocalConversation(
    method.definition.title,
    method.space_id,
    method.agent_id,
  );
  useMistyStore.setState((state) => ({
    conversations: [
      conversation,
      ...state.conversations.filter((chat) => chat.id !== conversation.id),
    ],
  }));
  return conversation.id;
}

/**
 * Runs an occurrence this window claimed. The claim is already recorded, so nothing here can start it
 * twice: an occurrence that never started goes back to being due, and one that may have started ends.
 */
export async function startScheduledRun(
  account: string,
  schedule: LocalSchedule,
  method: LocalMethod,
  now: number,
): Promise<void> {
  const prompt = scheduledRunPrompt(schedule, method, now);
  if (prompt === null) {
    await completeScheduleRun(
      account,
      method.id,
      "Its saved inputs no longer fit this workflow. Edit the schedule's inputs.",
      now,
    );
    return;
  }
  let conversationId: string;
  try {
    conversationId = await scheduleConversation(account, schedule, method);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Misty could not start this run.";
    await releaseSchedule(account, method.id, now, reason);
    return;
  }
  const store = useMistyStore.getState();
  // A turn sent now would be steered into the task the person just started.
  if (store.working || store.accountId !== account) {
    await releaseSchedule(account, method.id, now);
    return;
  }
  const before = { selectedAgentId: store.selectedAgentId, active: store.activeConversationId };
  useMistyStore.setState({ selectedAgentId: method.agent_id });
  const folder = useScheduleFolders.getState().byWorkflow[method.id];
  if (folder) {
    const folders = useConversationFolder.getState();
    folders.setFolder(conversationId, folder.folderId);
    folders.setWritable(conversationId, folder.folderId, folder.writable);
    await adoptFolderChanges(`workflow:${method.id}`, conversationId).catch(() => undefined);
  }
  const idempotencyKey = `workflow-schedule:${schedule.id}:${schedule.due_at ?? new Date(now).toISOString()}`;
  try {
    await useMistyStore.getState().submitAnswer(
      prompt,
      [],
      undefined,
      "workspace",
      [],
      { conversationId, context: [] },
      {
        executionMode: method.definition.target === "cloud" ? "user" : "agent",
        methodVersionId: method.version_id,
        idempotencyKey,
        // Nobody is watching it run, so it can't stop to ask before each change. A page's sends,
        // deletes and payments still stop natively, whatever the mode.
        permissionMode: "auto",
        // Nor can whatever the composer was left on, such as Plan, decide how it works.
        collaborationMode: "act",
        schedule: { id: schedule.id, claim: "" },
        // A workflow runs in its own Space, whichever one this window shows.
        spaceId: method.space_id,
      },
    );
  } catch (error) {
    await completeScheduleRun(
      account,
      method.id,
      error instanceof Error ? error.message : "Misty could not start this run.",
      Date.now(),
    );
    return;
  }
  const after = useMistyStore.getState();
  // A scheduled run doesn't take over what the person has open.
  useMistyStore.setState({
    selectedAgentId: before.selectedAgentId,
    activeConversationId: before.active,
  });
  const invocationId =
    after.invocationConversationId === conversationId ? after.invocationId : undefined;
  await bindScheduleRun(account, method.id, conversationId, invocationId, Date.now());
  if (!invocationId)
    await completeScheduleRun(
      account,
      method.id,
      after.error ?? "Misty could not start this run.",
      Date.now(),
    );
}

type RunOutcome = { live: true } | { live: false; error: string };

const closedEarly = "Misty closed before this run finished.";

/** The run's reply as this window holds it, or as it was last saved: a window just opened may not have it yet. */
async function replyOf(
  account: string,
  schedule: LocalSchedule,
): Promise<GlobalAiMessage | undefined> {
  const of = (messages: GlobalAiMessage[] | undefined) =>
    messages?.find(
      (message) =>
        message.role === "assistant" && message.invocationId === schedule.last_invocation_id,
    );
  const chatId = schedule.conversation_id ?? "";
  const held = useMistyStore.getState().conversations.find((item) => item.id === chatId);
  if (held) return of(held.messages);
  const saved = chatId ? await localDocuments.get(account, "conversation", chatId) : null;
  return saved ? of((JSON.parse(saved) as { messages?: GlobalAiMessage[] }).messages) : undefined;
}

/**
 * Whether this window's run of a schedule is still going. Native code knows, and a run outlives the app
 * (`resume_unfinished`), so a relaunch doesn't end a run that's still working. Only a run it knows
 * nothing of goes by its saved reply: it ended before this launch.
 */
export async function scheduledRunOutcome(
  schedule: LocalSchedule,
  account = useMistyStore.getState().accountId,
): Promise<RunOutcome> {
  // A pass waits for the start it began, so a claim with no run means Misty closed during it.
  if (!schedule.last_invocation_id) return { live: false, error: closedEarly };
  const state = await readRunState(schedule.last_invocation_id).catch(() => "running");
  if (state === "running") return { live: true };
  if (state === "completed") return { live: false, error: "" };
  if (state === "canceled") return { live: false, error: "This run was stopped." };
  const reply = await replyOf(account, schedule).catch(() => undefined);
  if (state === "failed")
    return { live: false, error: reply?.content || "This run stopped before it finished." };
  switch (reply?.state) {
    case "completed":
      return { live: false, error: "" };
    case "failed":
      return { live: false, error: reply.content || "This run stopped before it finished." };
    case "canceled":
      return { live: false, error: "This run was stopped." };
    default:
      return { live: false, error: closedEarly };
  }
}
