import type { AgentProfile } from "@/shared/schemas";
import { useSpeechModels, type InstallProgress, type VoiceView } from "@/features/voice";

export function agentVoice(profile: Pick<AgentProfile, "voice"> | undefined): string | undefined {
  return profile?.voice || undefined;
}

export function voiceInstalled(voice: string): boolean | undefined {
  const catalog = useSpeechModels.getState().catalog;
  if (!catalog) return undefined;
  return Boolean(catalog.voices.find((item) => item.id === voice)?.installed);
}

export function agentVoiceState(
  profile: Pick<AgentProfile, "voice"> | undefined,
): { kind: "none" } | { kind: "ready"; voice: string } | { kind: "setup"; voice: string } {
  const voice = agentVoice(profile);
  if (!voice) return { kind: "none" };
  return voiceInstalled(voice) === false ? { kind: "setup", voice } : { kind: "ready", voice };
}

export const voiceSetupLine = (name: string) => `Setting up ${name.trim() || "the agent"}’s voice`;

export function voiceProgress(
  progress: Record<string, InstallProgress>,
  voice: Pick<VoiceView, "id" | "packageKey"> | undefined,
): InstallProgress | undefined {
  if (!voice) return undefined;
  return progress[voice.id] ?? progress[voice.packageKey];
}
