import { currentApiBase, loadServerChoice } from "./server_choice";

const hostedScope = "hosted";

export function readDeploymentScope(): string {
  return hostedScope;
}

export function deploymentStorageKey(key: string): string {
  return `${key}:${hostedScope}`;
}

export function readDeploymentStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(deploymentStorageKey(key)) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function resolveApiBase(): Promise<string> {
  await loadServerChoice();
  return currentApiBase();
}

export function resolveHostedApiBase(): string {
  return currentApiBase();
}
