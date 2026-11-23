import { useCachedResource } from "@/api/cache/cached_resource";
import { marketApi, type MarketEngine } from "./api";

export function useEngineMarket(engine: MarketEngine | null) {
  return useCachedResource(
    engine ? `engines/market:${engine}` : null,
    () => marketApi.list(engine as MarketEngine),
    { persist: "device" },
  );
}
