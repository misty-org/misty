import { routes } from "./routes";

const startupPreferenceKey = "misty:startup-preference:v1";

export const startupViewOptions = ["Space", "Agents"];

const startupViewRoutes = [routes.spaces, routes.spaces, routes.agents];
const startupViewStoredIndexes = [0, 2];

export const startupViewOption = (storedIndex: number) =>
  Math.max(0, startupViewStoredIndexes.indexOf(storedIndex));
export const startupViewStoredIndex = (option: number) => startupViewStoredIndexes[option] ?? 0;

interface StartupPreference {
  reopenLastSession: boolean;
  startupViewIndex: number;
}

export function configureStartupPreference(preference: StartupPreference): void {
  try {
    window.localStorage.setItem(startupPreferenceKey, JSON.stringify(preference));
  } catch {}
}

function readStartupPreference(): StartupPreference {
  try {
    const raw = window.localStorage.getItem(startupPreferenceKey);
    if (!raw) return { reopenLastSession: true, startupViewIndex: 0 };
    const parsed = JSON.parse(raw) as Partial<StartupPreference>;
    return {
      reopenLastSession: parsed.reopenLastSession !== false,
      startupViewIndex: typeof parsed.startupViewIndex === "number" ? parsed.startupViewIndex : 0,
    };
  } catch {
    return { reopenLastSession: true, startupViewIndex: 0 };
  }
}

export function resolveStartupRoute(lastRoute: string): string {
  const preference = readStartupPreference();
  if (preference.reopenLastSession) {
    const path = lastRoute.split(/[?#]/)[0];
    return /^\/(spaces|agents)(\/|$)/.test(path) ? lastRoute : routes.spaces;
  }
  return startupViewRoutes[preference.startupViewIndex] ?? routes.spaces;
}
