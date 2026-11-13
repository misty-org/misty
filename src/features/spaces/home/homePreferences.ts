import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * The Space home's view (grid or list) and maker filter (all or yours), kept in `misty.db` for
 * this device. Its type, date and order refinement is kept with the other collections'
 * (`useCollectionRefinement`'s `remember`).
 */
export type HomePreferences = { view: "grid" | "list"; scope: "all" | "yours" };

const defaults: HomePreferences = { view: "grid", scope: "all" };

// Earlier versions kept the view and the maker filter under two webview keys; they are joined
// into one here, so the setting moves them into misty.db together.
const legacyKey = "misty.spaceHome";
try {
  const view = localStorage.getItem("misty.spaceHome.view");
  const scope = localStorage.getItem("misty.spaceHome.scope");
  if ((view !== null || scope !== null) && localStorage.getItem(legacyKey) === null) {
    localStorage.setItem(legacyKey, JSON.stringify({ view, scope }));
    localStorage.removeItem("misty.spaceHome.view");
    localStorage.removeItem("misty.spaceHome.scope");
  }
} catch {
  // Storage can be off; there is nothing of the old kind to move then.
}

export const useHomePreferences = createDeviceSetting<HomePreferences>({
  scope: "spaces.home",
  defaults,
  legacyKey,
  normalize: (stored) => {
    const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
    return {
      view: saved.view === "list" ? "list" : "grid",
      scope: saved.scope === "yours" ? "yours" : "all",
    };
  },
});
