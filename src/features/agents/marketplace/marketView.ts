import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { useEnginesList } from "../engines/enginesApi";
import { failureText, type MarketSort } from "./api";

/** Which section of Explore an engine choice belongs to. */
export type MarketSection = "plugins" | "skills";

interface MarketView {
  sort: MarketSort;
  /** The engine last picked in each section, by id; "" before any pick. */
  plugins: string;
  skills: string;
}

/** The order and the engines the person last chose, kept for this device in `misty.db`. */
export const useMarketView = createDeviceSetting<MarketView>({
  scope: "marketplace-view",
  defaults: { sort: "popular", plugins: "", skills: "" },
  normalize: (stored) => {
    const saved = stored as Partial<Record<keyof MarketView, unknown>> | null;
    return {
      sort: saved?.sort === "name" ? "name" : "popular",
      plugins: typeof saved?.plugins === "string" ? saved.plugins : "",
      skills: typeof saved?.skills === "string" ? saved.skills : "",
    };
  },
});

export const setMarketSort = (sort: MarketSort) =>
  useMarketView.getState().set((current) => ({ ...current, sort }));

/**
 * The installed engines a section can add to, and the one picked: the last pick while it is
 * still installed, else the first. `engines` is null while the list is first read; `error` says
 * why it couldn't be read when there is nothing to show.
 */
export function useMarketEngines(section: MarketSection, offers: (engine: string) => boolean) {
  const list = useEnginesList();
  const picked = useMarketView((state) => state.value[section]);
  const engines = list.data
    ? list.data.filter((entry) => entry.installed && offers(entry.id))
    : null;
  const engine = engines?.some((entry) => entry.id === picked) ? picked : (engines?.[0]?.id ?? "");
  return {
    engines,
    engine,
    name: engines?.find((entry) => entry.id === engine)?.name ?? engine,
    error:
      !list.data && list.error ? failureText(list.error, "The engines couldn't be listed.") : null,
    reload: () => void list.reload(),
    pick: (next: string) =>
      useMarketView.getState().set((current) => ({ ...current, [section]: next })),
  };
}
