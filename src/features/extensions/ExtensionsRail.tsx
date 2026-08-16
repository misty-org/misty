import { Compass, Download, Puzzle } from "lucide-react";
import {
  Button,
  WorkspaceSectionLabel,
  WorkspaceSidebar,
  WorkspaceSidebarHeading,
  cn,
  itemToneClass,
  navigationMenuLinkClass,
} from "@/shared/ui";
import { categoryTones, type ExtensionCategory } from "./extensionCategories";

/** The Extensions sidebar: Discover, Installed and the catalog's categories. */
export function ExtensionsRail({
  categories,
  category,
  inInstalled,
  detailId,
  go,
}: {
  categories: ExtensionCategory[];
  category: string | null;
  inInstalled: boolean;
  detailId?: string;
  go(route: string): void;
}) {
  return (
    <WorkspaceSidebar aria-label="Extensions navigation" className="gap-1 pt-3">
      <WorkspaceSidebarHeading title="Extensions" leading={<Puzzle size={18} />} />
      <WorkspaceSectionLabel className="mt-2">Explore</WorkspaceSectionLabel>
      {[
        {
          name: "Discover",
          route: "/extensions",
          Icon: Compass,
          tone: "blue" as const,
          active: !inInstalled && !category && !detailId,
        },
        {
          name: "Installed",
          route: "/extensions/installed",
          Icon: Download,
          tone: "green" as const,
          active: inInstalled,
        },
      ].map(({ name, route, Icon, tone, active }) => (
        <Button
          variant="ghost"
          key={name}
          className={cn(navigationMenuLinkClass, "w-full")}
          aria-current={active ? "page" : undefined}
          onClick={() => go(route)}
        >
          <Icon size={18} className={itemToneClass(tone)} />
          <span>{name}</span>
        </Button>
      ))}
      <WorkspaceSectionLabel>Categories</WorkspaceSectionLabel>
      {categories.map(({ id, name, Icon }) => (
        <Button
          variant="ghost"
          key={id}
          className={cn(navigationMenuLinkClass, "w-full")}
          aria-current={category === id ? "page" : undefined}
          onClick={() => go(`/extensions?category=${id}`)}
        >
          <Icon size={18} className={itemToneClass(categoryTones[id] ?? "sand")} />
          <span>{name}</span>
        </Button>
      ))}
    </WorkspaceSidebar>
  );
}
