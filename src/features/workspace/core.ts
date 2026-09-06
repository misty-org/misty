// Core shell contract. Keep desktop-only multi-panel widgets out of this
// surface so mobile and account routes do not pull them into their bundles.
export * from "./model";
export * from "./dockTree";
export * from "./dockRegistry";
export * from "./paneNavigation";
export * from "./routeSurface";
export * from "./useWorkspaceStore";
export * from "./useWorkspaceTabTitle";
export * from "./useRecentToolsStore";
export * from "./navigatorApps";
export * from "./useNavigatorAppsStore";
export * from "./WorkspaceAppIcon";
export * from "./MistyBrandIcon";
export * from "./workspaceTabOperations";
export * from "./WorkspaceTabRouteScope";
export * from "./workspaceDefaultTab";
export * from "./mobileWorkspaceProjection";
