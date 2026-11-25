import type { AgentProfile } from "@/shared/schemas";

export function agentVoice(profile: Pick<AgentProfile, "voice"> | undefined): string | undefined {
  return profile?.voice || undefined;
}
