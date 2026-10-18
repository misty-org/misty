/**
 * Public-beta product gates.
 *
 * Keep this list deliberately small and explicit. A feature leaves this file
 * only after its complete user journey has passed launch QA.
 */
const publicBetaAvailability = {
  connectedDevices: false,
  desktopMistyPanel: false,
  extensions: false,
  mcpConnections: true,
  recurringBriefings: false,
  smartLibraryAnalysis: false,
  // Voice, notes and memory (docs/design/voice-memory/BRIEF.md), by phase.
  voiceDictation: false,
  voiceNotes: false,
  recall: false,
  captureSessions: false,
} as const;

export type PublicBetaFeature = keyof typeof publicBetaAvailability;

export function publicBetaFeatureEnabled(feature: PublicBetaFeature): boolean {
  return publicBetaAvailability[feature];
}
