import { createDeviceSetting } from "@/shared/lib/device_setting";
import { useEnginesList } from "../engines/engines_api";
import { failureText, type MarketSort } from "./api";

export type MarketSection = "plugins" | "skills";

interface MarketView {
  sort: MarketSort;
  plugins: string;
  skills: string;
}

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
