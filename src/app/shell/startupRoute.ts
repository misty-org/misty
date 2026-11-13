import { routes } from "./routes";

/**
 * Which view Misty opens on.
 *
 * The index route redirects on the very first render, long before the settings
 * document has come back from disk, so the two startup preferences are
 * mirrored into localStorage as they are saved and read back synchronously
 * here. The settings document stays the source of truth; this is a cache that
 * exists so the first paint does not have to wait on a Tauri round-trip.
 */
const startupPreferenceKey = "misty:startup-preference:v1";

export const startupViewOptions = ["Space", "Agents"];

/** Stored indexes keep their old meaning: 0 was Browser and 1 the retired Files view, and both
 * now open the Space. */
const startupViewRoutes = [routes.spaces, routes.spaces, routes.agents];
const startupViewStoredIndexes = [0, 2];

/** The option shown for a stored index, and the index stored for an option. */
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
  } catch {
    // Private modes can disable localStorage; the app still opens on the default.
  }
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

/**
 * Resolves the route the index should redirect to, for someone signed in.
 *
 * `lastRoute` comes from the route-memory store, which already persists and
 * validates the last rememberable route.
 */
export function resolveStartupRoute(lastRoute: string): string {
  const preference = readStartupPreference();
  if (preference.reopenLastSession) {
    const path = lastRoute.split(/[?#]/)[0];
    return /^\/(spaces|agents)(\/|$)/.test(path) ? lastRoute : routes.spaces;
  }
  return startupViewRoutes[preference.startupViewIndex] ?? routes.spaces;
}
