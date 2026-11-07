/** A run waiting for the person to do something on screen, held on this computer (`localWaits.ts`). */
export interface AgentInterventionWait {
  id: string;
  runId: string;
  scopeId: string;
  deviceId: string;
  targetLabel: string;
  action: "sign_in" | "account_confirmation" | "challenge" | "open_target" | "review";
  reason: string;
  state: "pending";
  expiresAt: string;
}
export const interventionLabels: Record<AgentInterventionWait["action"], string> = {
  sign_in: "Sign in so Misty can continue",
  account_confirmation: "Check that the right account is signed in",
  challenge: "Complete the verification on screen",
  open_target: "Open what Misty needs on screen",
  review: "Review the screen before Misty continues",
};
