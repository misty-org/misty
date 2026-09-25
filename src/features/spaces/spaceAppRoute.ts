import { packageRoute } from "@/shared/lib/toolRoutes";
import { canonicalSpaceRoute } from "./spaceRouteNormalization";

/** Preserve existing links to shared content after moving it out of Apps. */
export function spaceToolRouteFromAppRoute(route: string, fallbackSpaceId = ""): string | null {
  const url = new URL(route, "https://misty.local");
  const slug = url.pathname.split("/")[2];
  if (
    !url.pathname.startsWith("/apps/") ||
    !["social", "journal", "planner", "library"].includes(slug)
  )
    return null;
  const provider = url.searchParams.get("provider");
  if (provider && provider !== "misty") return null;
  if (
    url.searchParams.get("view") === "integrations" ||
    url.searchParams.get("drawer") === "integrations"
  )
    return null;
  const spaceId = url.searchParams.get("space") || fallbackSpaceId;
  if (!spaceId) return null;
  // A plain personal-app link opens its integration directory. Explicit Misty,
  // Space, and feature links retain their previous collaborative destination.
  if (
    provider !== "misty" &&
    !url.searchParams.has("space") &&
    !url.searchParams.has("view") &&
    !url.searchParams.has("collection")
  )
    return null;
  const adapted = new URL(
    packageRoute(slug === "social" ? "chat" : slug, spaceId, route),
    "https://misty.local",
  );
  adapted.searchParams.delete("space");
  adapted.searchParams.delete("provider");
  return canonicalSpaceRoute(`${adapted.pathname}${adapted.search}${adapted.hash}`);
}
