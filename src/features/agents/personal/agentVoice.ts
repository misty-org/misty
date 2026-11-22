import type { AgentProfile } from "@/shared/schemas";
import { useSpeechModels, type InstallProgress, type VoiceView } from "@/features/voice";

/**
 * An agent's own voice (a speech catalog id, "kokoro-heart"), picked by its person when they made
 * it. Undefined for an agent made before voices, which speaks in Misty's voice until one is picked.
 */
export function agentVoice(profile: Pick<AgentProfile, "voice"> | undefined): string | undefined {
  return profile?.voice || undefined;
}

/**
 * Whether `voice` is on this computer, from the speech catalog as last read; undefined before the
 * window has read it (it's read at the window's start, `watchSpeechSetup`).
 */
export function voiceInstalled(voice: string): boolean | undefined {
  const catalog = useSpeechModels.getState().catalog;
  if (!catalog) return undefined;
  return Boolean(catalog.voices.find((item) => item.id === voice)?.installed);
}

/**
 * Where an agent's voice stands: `none` speaks in Misty's voice, `ready` in its own, and `setup`
 * means its voice isn't on this computer yet, so it doesn't speak (Misty never swaps in another
 * voice) and says "Setting up <name>'s voice" instead.
 */
export function agentVoiceState(
  profile: Pick<AgentProfile, "voice"> | undefined,
): { kind: "none" } | { kind: "ready"; voice: string } | { kind: "setup"; voice: string } {
  const voice = agentVoice(profile);
  if (!voice) return { kind: "none" };
  // Before the catalog is read, native code decides: it speaks a voice that's here.
  return voiceInstalled(voice) === false ? { kind: "setup", voice } : { kind: "ready", voice };
}

/** "Setting up Ada's voice". */
export const voiceSetupLine = (name: string) => `Setting up ${name.trim() || "the agent"}’s voice`;

/** A voice's download as it comes in: by its own id, or the package it shares with other voices. */
export function voiceProgress(
  progress: Record<string, InstallProgress>,
  voice: Pick<VoiceView, "id" | "packageKey"> | undefined,
): InstallProgress | undefined {
  if (!voice) return undefined;
  return progress[voice.id] ?? progress[voice.packageKey];
}
