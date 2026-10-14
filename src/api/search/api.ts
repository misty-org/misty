import { apiRequest } from "@/api/client";
import type { GlobalSpaceLibraryHit } from "@/api/spaces/dto/search";

export const searchApi = {
  spaceLibraries: (query: string, limit = 50) =>
    apiRequest<{ hits: GlobalSpaceLibraryHit[]; semantic: boolean; request_id: string }>(
      `/search/spaces?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
};
