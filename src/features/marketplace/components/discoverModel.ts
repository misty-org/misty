import type { OfficialApp } from "@/api/apps";
export {
  discoverAppName,
  discoverAppAction,
  discoverAppPlatform,
  discoverAppSize,
} from "@/features/apps/appDetailsModel";

export type DiscoverSection = "featured" | "apps" | "installed";
export const discoverCategories = ["All Apps", "Creative", "Productivity", "Utilities"] as const;
export type DiscoverCategory = (typeof discoverCategories)[number];

export function discoverAppCategory(app: OfficialApp): DiscoverCategory {
  if (["journal", "library"].includes(app.id)) return "Creative";
  if (["chat", "planner", "inbox", "agents"].includes(app.id)) return "Productivity";
  return "Utilities";
}
