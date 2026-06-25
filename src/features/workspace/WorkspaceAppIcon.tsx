import { cn } from "@/shared/ui";
import { appIcon, appIconStrokeWidth } from "@/shared/ui/app-icons";
import type { WorkspaceToolId } from "./useRecentToolsStore";

type WorkspaceAppIconSize = "picker" | "nav" | "marketplace" | "tree";

export { appIcon as workspaceAppIcon };

/** Keeps top-level app identity neutral across navigation, Settings, and Discover. */
export function workspaceAppIconColorClass(_appId: WorkspaceToolId): string {
  return "text-cream-bright";
}

const sizeDetails: Record<WorkspaceAppIconSize, { tileClass: string; iconSize: number }> = {
  picker: { tileClass: "size-5", iconSize: 15 },
  tree: { tileClass: "size-5", iconSize: 18 },
  nav: { tileClass: "size-7", iconSize: 20 },
  marketplace: { tileClass: "size-10", iconSize: 22 },
};

export function WorkspaceAppIcon(props: {
  appId: WorkspaceToolId;
  size?: WorkspaceAppIconSize;
  className?: string;
  context?: "app" | "space";
}) {
  const size = props.size ?? "nav";
  const sizing = sizeDetails[size];
  const Icon = appIcon(props.appId, props.context)!;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center",
        workspaceAppIconColorClass(props.appId),
        sizing.tileClass,
        props.className,
      )}
      data-app-icon={props.appId}
    >
      <Icon
        className={size === "nav" || size === "tree" ? "!size-5" : undefined}
        size={sizing.iconSize}
        strokeWidth={appIconStrokeWidth}
      />
    </span>
  );
}
