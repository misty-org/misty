/**
 * Public-beta product gates.
 *
 * Keep this list deliberately small and explicit. A feature leaves this file
 * only after its complete user journey has passed launch QA.
 */
export const publicBetaAvailability = {
  connectedDevices: false,
  desktopMistyPanel: false,
  extensions: false,
  mcpConnections: false,
  recurringBriefings: false,
  smartLibraryAnalysis: false,
  transfers: false,
} as const;

export type PublicBetaFeature = keyof typeof publicBetaAvailability;

export function publicBetaFeatureEnabled(feature: PublicBetaFeature): boolean {
  return publicBetaAvailability[feature];
}
