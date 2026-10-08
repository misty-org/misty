import { z } from "zod";
import { apiRequest } from "@/api/client";

const waitSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  scopeId: z.string(),
  deviceId: z.string(),
  targetLabel: z.string(),
  action: z.enum(["sign_in", "account_confirmation", "challenge", "open_target", "review"]),
  reason: z.string().max(1000),
  state: z.literal("pending"),
  expiresAt: z.string().datetime({ offset: true }),
});
export type AgentInterventionWait = z.infer<typeof waitSchema>;
export const interventionLabels: Record<AgentInterventionWait["action"], string> = {
  sign_in: "Sign in so Misty can continue",
  account_confirmation: "Check that the right account is signed in",
  challenge: "Complete the verification on screen",
  open_target: "Open what Misty needs on screen",
  review: "Review the screen before Misty continues",
};

// Trusted host controls only: never register this API in the app RPC catalog.
export const agentInterventionsApi = {
  async list(signal?: AbortSignal) {
    return z
      .object({ waits: z.array(waitSchema).max(100) })
      .parse(await apiRequest<unknown>("/me/agent-interventions", { signal }));
  },
  async decide(id: string, ready: boolean, signal?: AbortSignal) {
    z.string().uuid().parse(id);
    return z.object({ queued: z.literal(true) }).parse(
      await apiRequest<unknown>(`/me/agent-interventions/${encodeURIComponent(id)}`, {
        method: "POST",
        body: JSON.stringify({ ready }),
        signal,
      }),
    );
  },
};
