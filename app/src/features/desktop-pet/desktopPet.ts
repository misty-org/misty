import { Window } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";

export const desktopPetLabels = {
  pet: "misty-bot-pet",
  main: "main",
} as const;

export const desktopPetEvents = {
  togglePanel: "misty://desktop-panel-toggle",
  appAction: "misty://desktop-app-action",
} as const;

export type DesktopMistyAppAction =
  { type: "navigate"; href: string } | { type: "command"; commandId?: string; tabId?: string };

export type MistyDesktopSurface = "pet" | null;

export function mistyDesktopSurface(): MistyDesktopSurface {
  const value = new URLSearchParams(window.location.search).get("misty-surface");
  return value === "pet" ? value : null;
}

export async function toggleDesktopMistyPanel(): Promise<boolean> {
  if (!hasTauriInternals()) return false;
  const pet = await Window.getByLabel(desktopPetLabels.pet);
  if (!pet) return false;
  await pet.show();
  await pet.unminimize();
  await pet.emit(desktopPetEvents.togglePanel);
  return true;
}

export async function revealMainMistyApp(action?: DesktopMistyAppAction): Promise<void> {
  if (!hasTauriInternals()) return;
  const main = await Window.getByLabel(desktopPetLabels.main);
  if (!main) return;
  await main.show();
  await main.unminimize();
  await main.setFocus();
  if (action) await main.emit(desktopPetEvents.appAction, action);
}
