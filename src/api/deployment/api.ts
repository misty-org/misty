import { currentApiBase, loadServerChoice } from "./serverChoice";

/** Misty is hosted only, so every client uses the one Hosted namespace. */
const hostedScope = "hosted";

export function readDeploymentScope(): string {
  return hostedScope;
}

export function deploymentStorageKey(key: string): string {
  return `${key}:${hostedScope}`;
}

/** Reads the namespaced key, falling back to the pre-namespacing key so
 * existing installations retain their local state. */
export function readDeploymentStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(deploymentStorageKey(key)) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The Misty server's API base: the one chosen on this device in the setup wizard, "" when
 * Misty is the browser only, or in development the build's default (serverChoice.ts).
 */
export async function resolveApiBase(): Promise<string> {
  await loadServerChoice();
  return currentApiBase();
}

/** The same base, read synchronously; the app reads the choice before it renders. */
export function resolveHostedApiBase(): string {
  return currentApiBase();
}
