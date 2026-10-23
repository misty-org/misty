import { apiRequest } from "@/api/client";
import { windowSpaceId } from "@/features/recall/windowSpace";

/** Forgets screen moments older than the chosen number of days, so capture never grows without end. */
export function purgeExpiredScreenMemory(keepDays: number): Promise<unknown> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  return apiRequest("/me/memory/forget", {
    method: "POST",
    body: JSON.stringify({
      space_id: windowSpaceId(),
      node_id: "moments:kind:screen",
      from: "2000-01-01T00:00:00Z",
      to: cutoff,
    }),
  });
}
