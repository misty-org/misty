import { useCachedResource } from "@/api/cache/cached-resource";
import { marketApi, type MarketEngine } from "./api";

/**
 * An engine's plugins and marketplaces, kept on this computer: the last list paints at once and is
 * listed anew behind it. The catalog and the marketplace rail share the one listing.
 */
export function useEngineMarket(engine: MarketEngine | null) {
  return useCachedResource(
    engine ? `engines/market:${engine}` : null,
    () => marketApi.list(engine as MarketEngine),
    { persist: "device" },
  );
}
