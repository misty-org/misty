import type { GlobalAiMessage } from "../../conversations/state/conversation_types";
import type { HandoffState } from "./protocol";

export function handoffStateOf(reply: GlobalAiMessage | undefined): HandoffState {
  if (!reply) return "working";
  if (reply.state === "completed") return "done";
  if (reply.state === "failed" || reply.state === "canceled") return "failed";
  if (reply.appRequest?.state === "pending" || reply.screenRequest?.state === "pending")
    return "waiting";
  return "working";
}
