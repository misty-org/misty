import type { GlobalAiMessage } from "../../conversations/state/conversationTypes";
import type { HandoffState } from "./protocol";

/**
 * How a handed-off turn is going, from its reply in the agent's thread: waiting while it needs
 * the person (an app to connect, an action to approve, a screen to open), working until it ends.
 */
export function handoffStateOf(reply: GlobalAiMessage | undefined): HandoffState {
  if (!reply) return "working";
  if (reply.state === "completed") return "done";
  if (reply.state === "failed" || reply.state === "canceled") return "failed";
  if (reply.appRequest?.state === "pending" || reply.screenRequest?.state === "pending")
    return "waiting";
  return "working";
}
