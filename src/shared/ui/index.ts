// The only import path for shared UI. Features import from "@/shared/ui", never a subfolder.

// controls
export * from "./controls/Button";
export * from "./controls/Checkbox";
export { IconButton as PrimitiveIconButton } from "./controls/IconButton";
export type { IconButtonProps as PrimitiveIconButtonProps } from "./controls/IconButton";
export * from "./controls/Input";
export * from "./controls/InputGroup";
export * from "./controls/Label";
export { IconButton } from "./controls/OutlinedIconButton";
export type { IconButtonProps } from "./controls/OutlinedIconButton";
export * from "./controls/RadioGroup";
export * from "./controls/Select";
export * from "./controls/Slider";
export * from "./controls/Switch";
export * from "./controls/Textarea";
export * from "./controls/Toggle";
export * from "./controls/ToggleGroup";

// overlays
export * from "./overlays/AlertDialog";
export * from "./overlays/Command";
export * from "./overlays/ContextMenu";
export * from "./overlays/Dialog";
export * from "./overlays/DropdownMenu";
export * from "./overlays/Popover";
export * from "./overlays/Portal";
export * from "./overlays/Sheet";
export * from "./overlays/Tooltip";
export * from "./overlays/WorkspaceOverlay";
export * from "./overlays/popupStyles";

// layout
export * from "./layout/Collapsible";
export * from "./layout/DragLayer";
export * from "./layout/Layout";
export * from "./layout/OverflowFadeText";
export * from "./layout/ScrollArea";
export * from "./layout/Separator";
export * from "./layout/Tabs";
export * from "./layout/Toolbar";
export * from "./layout/overflowFade";

// display
export * from "./display/Avatar";
export * from "./display/Badge";
export * from "./display/Card";
export * from "./display/StatusBadge";
export * from "./display/Table";

// feedback
export * from "./feedback/Alert";
export * from "./feedback/Banner";
export * from "./feedback/LoadingScreen";
export * from "./feedback/Notification";
export * from "./feedback/Progress";
export * from "./feedback/Skeleton";
export * from "./feedback/Spinner";
export * from "./feedback/StateView";

// navigation
export * from "./navigation/Breadcrumb";
export * from "./navigation/NavIsland";
export * from "./navigation/NavigationMenu";
export * from "./navigation/NavigationTree";

// icons
export * from "./icons/AssetIcon";
export * from "./icons/BrandIcon";
export * from "./icons/MailProviderIcon";
export * from "./icons/ProviderBrandIcon";
export * from "./icons/WebsiteBrandIcon";
export * from "./icons/appIcons";
export * from "./icons/brandIcons";

// patterns
export * from "./patterns/ComingSoonSurface";
export * from "./patterns/DesktopAccessState";
export * from "./patterns/DiscoverCard";

export * from "./utils";
